/**
 * 도면 열기 오케스트레이션 (FR-1.2, P1-4) —
 * 확장자 판별 → (DWG면 서버 변환) → 파싱 워커 기동 → 진행률 스트리밍 → 모델 확정.
 *
 * DWG 경로: GET /api/convert/status 분기(설치됨→변환 / 미설치→안내 모달 /
 * 서버 미기동→토스트) 후, 변환된 DXF 텍스트를 기존 파싱 파이프라인에 그대로 투입.
 */
import { useAppStore } from '../store/index.ts';
import type { ParseDwgRequest, ParseRequest, ParseResponse } from '../workers/messages.ts';
import {
  backendDisplayName,
  convertDwgFile,
  dxfNameFromDwg,
  fetchDwgRoute,
} from './convert-api.ts';
import { pushRecentFile } from './recent-files.ts';
import { applyLoadedModel } from './switch-drawing.ts';

let activeWorker: Worker | null = null;

/** 열기 동작 세대 — 변환 중 다른 파일이 열리면 이전 변환 결과를 폐기한다 */
let openSeq = 0;

/** 파일 선택 다이얼로그 (File System Access API 불필요 — input[type=file]) */
export function pickDxfFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.dxf,.dwg';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file !== undefined) openDrawingFile(file);
  };
  input.click();
}

export function openDrawingFile(file: File): void {
  openSeq += 1;
  const store = useAppStore.getState();
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.dwg')) {
    void openDwgFile(file, openSeq);
    return;
  }
  if (!lower.endsWith('.dxf')) {
    store.showToast('지원하지 않는 형식입니다 — .dxf 파일을 선택하세요', 'error');
    return;
  }
  parseDxfFile(file);
}

/**
 * DWG 경로 (RW-24) — 브라우저 WASM 리더로 직접 변환(서버·exe 불필요) 1순위,
 * 실패 시 기존 서버 변환 경로로 폴백.
 */
async function openDwgFile(file: File, seq: number): Promise<void> {
  try {
    await parseDwgViaWasm(file, seq);
  } catch (err) {
    if (seq !== openSeq) return;
    const message = err instanceof Error ? err.message : 'DWG 브라우저 변환 실패';
    // WASM 실패(드묾) → 네이티브 서버 변환(LibreDWG/ODA) 폴백. 그것도 없으면 안내 모달.
    useAppStore
      .getState()
      .showToast(`브라우저 DWG 변환 실패(${message}) — 서버 변환으로 재시도합니다`, 'warn');
    await openDwgFileViaServer(file, seq);
  }
}

/**
 * DWG 브라우저 변환 — 전용 워커에서 libredwg-web 리더 + core dwgDatabaseToDxf +
 * parseAndNormalizeDxf 를 수행한다. 하드 타임아웃으로 드문 WASM 무한루프를 방어한다.
 * done 이면 모델 확정, error/timeout 이면 reject → 상위에서 서버 폴백.
 */
function parseDwgViaWasm(file: File, seq: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const store = useAppStore.getState();
    activeWorker?.terminate();
    const worker = new Worker(new URL('../workers/dwg-parse.worker.ts', import.meta.url), {
      type: 'module',
    });
    activeWorker = worker;
    // 백엔드 라벨 'LibreDWG' 로 로딩 오버레이 표기 재사용.
    store.startLoading(file.name, 'libredwg');
    store.setLoadProgress('convert', -1);

    // 하드 타임아웃(90초) — 일부 도면의 WASM 무한루프 대비. 종료 후 폴백.
    const timeoutId = setTimeout(() => {
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      reject(new Error('변환 시간 초과(90초)'));
    }, 90_000);

    const finish = () => {
      clearTimeout(timeoutId);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
    };

    worker.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const msg = ev.data;
      // 도중에 다른 파일이 열렸으면 조용히 폐기(성공 처리로 종료).
      if (seq !== openSeq) {
        finish();
        resolve();
        return;
      }
      const s = useAppStore.getState();
      switch (msg.type) {
        case 'progress':
          s.setLoadProgress(msg.stage, msg.progress);
          break;
        case 'done': {
          applyLoadedModel(msg.model, file.name);
          pushRecentFile(file.name, msg.model.entities.length);
          const skippedTotal = msg.skipped
            ? Object.values(msg.skipped).reduce((a, b) => a + b, 0)
            : 0;
          const after = useAppStore.getState();
          const restoredNote = after.calibration !== null ? ' · 저장된 캘리브레이션 복원됨' : '';
          const skippedNote =
            skippedTotal > 0 ? ` · 미지원 ${skippedTotal.toLocaleString('ko-KR')}개 형식 제외` : '';
          s.showToast(
            `${file.name} — ${msg.model.entities.length.toLocaleString('ko-KR')}개 엔티티 로드 (${Math.round(
              msg.elapsed_ms,
            )}ms)${restoredNote}${skippedNote}`,
            'success',
          );
          finish();
          resolve();
          break;
        }
        case 'error':
          finish();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      finish();
      reject(new Error(ev.message !== '' ? ev.message : 'DWG 워커 실행 오류'));
    };

    worker.postMessage({ type: 'parse-dwg', file } satisfies ParseDwgRequest);
  });
}

/**
 * DWG 서버 변환 폴백 — 로컬 서버(LibreDWG/ODA) 경로. 브라우저 WASM 실패 시에만 진입.
 * seq가 어긋나면(도중에 다른 파일 열림) 결과를 조용히 폐기한다.
 */
async function openDwgFileViaServer(file: File, seq: number): Promise<void> {
  const route = await fetchDwgRoute();
  if (seq !== openSeq) return;
  const store = useAppStore.getState();

  if (route.kind === 'server-down') {
    store.showToast(route.message, 'warn');
    return;
  }
  if (route.kind === 'guide') {
    // 변환 백엔드(LibreDWG/ODA) 미설치 — 설치 안내 모달 (재시도 버튼 포함)
    store.showDwgGuide(file, route.guide);
    return;
  }

  // 변환 진행 오버레이 — 파싱 오버레이의 'convert' 단계 재사용 (indeterminate).
  // 서버가 알려준 백엔드가 있으면 라벨에 병기: 'DWG 변환 중 (LibreDWG)'
  store.startLoading(
    file.name,
    route.backend !== undefined ? backendDisplayName(route.backend) : undefined,
  );
  store.setLoadProgress('convert', -1);
  try {
    const dxfText = await convertDwgFile(file);
    if (seq !== openSeq) return;
    const dxfName = dxfNameFromDwg(file.name);
    useAppStore.getState().showToast(`DWG 변환 완료 — ${dxfName} 파싱 시작`, 'success');
    // 변환 산출 DXF 텍스트를 기존 파싱 파이프라인에 그대로 투입 (파일명 .dwg→.dxf 표기)
    parseDxfFile(new File([dxfText], dxfName, { type: 'application/dxf' }));
  } catch (err) {
    if (seq !== openSeq) return;
    const s = useAppStore.getState();
    const message = err instanceof Error ? err.message : 'DWG 변환 실패';
    s.failLoading(message);
    s.showToast(`DWG 변환 실패: ${message}`, 'error');
  }
}

/** 기존 DXF 파싱 파이프라인 — 워커 기동·진행률·모델 확정 (회귀 금지 영역) */
function parseDxfFile(file: File): void {
  const store = useAppStore.getState();
  const name = file.name;

  // 이전 파싱이 진행 중이면 중단
  activeWorker?.terminate();
  const worker = new Worker(new URL('../workers/dxf-parse.worker.ts', import.meta.url), {
    type: 'module',
  });
  activeWorker = worker;
  store.startLoading(name);

  const finish = () => {
    worker.terminate();
    if (activeWorker === worker) activeWorker = null;
  };

  worker.onmessage = (ev: MessageEvent<ParseResponse>) => {
    const msg = ev.data;
    const s = useAppStore.getState();
    switch (msg.type) {
      case 'progress':
        s.setLoadProgress(msg.stage, msg.progress);
        break;
      case 'done': {
        // 로드 후처리 단일 오케스트레이터 — finishLoading(스냅샷 병합·재열기 판별·flat 복원)
        // 이후 확정된 활성 model로 setSceneModel까지 한 곳에서 수행한다(집중 항목 6).
        applyLoadedModel(msg.model, name);
        pushRecentFile(name, msg.model.entities.length);
        const after = useAppStore.getState();
        const restoredNote = after.calibration !== null ? ' · 저장된 캘리브레이션 복원됨' : '';
        s.showToast(
          `${name} — ${msg.model.entities.length.toLocaleString('ko-KR')}개 엔티티 로드 (${Math.round(msg.elapsed_ms)}ms)${restoredNote}`,
          'success',
        );
        finish();
        break;
      }
      case 'error':
        s.failLoading(msg.message);
        s.showToast(`DXF 파싱 실패: ${msg.message}`, 'error');
        finish();
        break;
    }
  };

  worker.onerror = (ev: ErrorEvent) => {
    const s = useAppStore.getState();
    const message = ev.message !== '' ? ev.message : '워커 실행 오류';
    s.failLoading(message);
    s.showToast(`DXF 파싱 실패: ${message}`, 'error');
    finish();
  };

  worker.postMessage({ type: 'parse', file } satisfies ParseRequest);
}
