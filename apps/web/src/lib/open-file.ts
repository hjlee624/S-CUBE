/**
 * 도면 열기 오케스트레이션 (FR-1.2, P1-4) —
 * 확장자 판별 → (DWG면 서버 변환) → 파싱 워커 기동 → 진행률 스트리밍 → 모델 확정.
 *
 * DWG 경로: GET /api/convert/status 분기(설치됨→변환 / 미설치→안내 모달 /
 * 서버 미기동→토스트) 후, 변환된 DXF 텍스트를 기존 파싱 파이프라인에 그대로 투입.
 */
import { setSceneModel } from '../canvas/scene.ts';
import { useAppStore } from '../store/index.ts';
import type { ParseRequest, ParseResponse } from '../workers/messages.ts';
import { convertDwgFile, dxfNameFromDwg, fetchDwgRoute } from './convert-api.ts';
import { pushRecentFile } from './recent-files.ts';

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
 * DWG 경로 — 서버 변환 후 DXF로 재진입.
 * seq가 어긋나면(도중에 다른 파일 열림) 결과를 조용히 폐기한다.
 */
async function openDwgFile(file: File, seq: number): Promise<void> {
  const route = await fetchDwgRoute();
  if (seq !== openSeq) return;
  const store = useAppStore.getState();

  if (route.kind === 'server-down') {
    store.showToast(route.message, 'warn');
    return;
  }
  if (route.kind === 'guide') {
    // ODA File Converter 미설치 — 설치 안내 모달 (재시도 버튼 포함)
    store.showDwgGuide(file, route.guide);
    return;
  }

  // 변환 진행 오버레이 — 파싱 오버레이의 'convert' 단계 재사용 (indeterminate)
  store.startLoading(file.name);
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
        setSceneModel(msg.model);
        s.finishLoading(msg.model, name);
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
