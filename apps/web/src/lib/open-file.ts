/**
 * 도면 열기 오케스트레이션 (FR-1.2, P1-4) —
 * 확장자 판별 → 파싱 워커 기동 → 진행률 스트리밍 → 모델 확정.
 */
import { setSceneModel } from '../canvas/scene.ts';
import { useAppStore } from '../store/index.ts';
import type { ParseRequest, ParseResponse } from '../workers/messages.ts';

let activeWorker: Worker | null = null;

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
  const store = useAppStore.getState();
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith('.dwg')) {
    store.showToast('DWG는 직접 열 수 없습니다 — CAD에서 DXF(ASCII)로 변환 후 사용하세요', 'warn');
    return;
  }
  if (!lower.endsWith('.dxf')) {
    store.showToast('지원하지 않는 형식입니다 — .dxf 파일을 선택하세요', 'error');
    return;
  }

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
