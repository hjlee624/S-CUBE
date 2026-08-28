/**
 * UI 슬라이스 — 활성 도구·토스트.
 * 캘리브레이션 미완료 시 dim-check 진입 차단 (P1-11).
 */
import type { StateCreator } from 'zustand';
import type { AppState, UiSlice } from './types.ts';

let toastSeq = 0;

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  activeTool: 'pan',
  toast: null,
  dwgGuide: null,

  setActiveTool: (tool) => {
    const s = get();
    if (tool !== 'pan' && s.model === null) {
      s.showToast('먼저 DXF 도면을 열어주세요', 'warn');
      return;
    }
    if (tool === 'dim-check' && s.calibration === null) {
      s.showToast('치수 대조는 캘리브레이션 완료 후 사용할 수 있습니다', 'warn');
      return;
    }
    // 도구 전환 시 진행 중이던 캘리브레이션 점 초기화
    set({ activeTool: tool, calibPoints: [], dimCheck: tool === 'dim-check' ? s.dimCheck : null });
  },

  showToast: (message, tone = 'info') => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, message, tone } });
  },

  dismissToast: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },

  showDwgGuide: (file, guide) => set({ dwgGuide: { file, guide } }),

  dismissDwgGuide: () => set({ dwgGuide: null }),
});
