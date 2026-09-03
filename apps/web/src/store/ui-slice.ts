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
  pendingSectionGround: null,
  activeStationId: null,
  stationDockOpen: false,
  stationDockTab: 'table',
  workbenchOpen: false,
  workbenchTab: 'stations',

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
    // 측정 도구는 캘리브레이션 완료 후에만 (FR-2.3). 도구 비활성이 1차 방어, 여기가 2차 안전장치.
    if (tool === 'measure' && s.calibration === null) {
      s.showToast('측정은 캘리브레이션 완료 후 사용할 수 있습니다', 'warn');
      return;
    }
    // 단면적 취득도 축척² 환산이 필수라 캘리브레이션 완료 후에만 (도구 비활성 1차 + 여기 2차 안전장치).
    if (tool === 'section-area' && s.calibration === null) {
      s.showToast('단면적 취득은 캘리브레이션 완료 후 사용할 수 있습니다', 'warn');
      return;
    }
    // 도구 전환 시 진행 중이던 캘리브레이션 점·단면적 1단계 선택 초기화. 측정 선택은 measure 이탈 시에만 유지.
    set({
      activeTool: tool,
      calibPoints: [],
      pendingSectionGround: null,
      dimCheck: tool === 'dim-check' ? s.dimCheck : null,
    });
  },

  setPendingSectionGround: (ground) => set({ pendingSectionGround: ground }),

  setActiveStationId: (id) => set({ activeStationId: id }),

  showToast: (message, tone = 'info') => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, message, tone } });
  },

  dismissToast: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },

  showDwgGuide: (file, guide) => set({ dwgGuide: { file, guide } }),

  dismissDwgGuide: () => set({ dwgGuide: null }),

  toggleStationDock: () => set((s) => ({ stationDockOpen: !s.stationDockOpen })),

  setStationDockTab: (tab) => set({ stationDockTab: tab, stationDockOpen: true }),

  toggleWorkbench: () => set((s) => ({ workbenchOpen: !s.workbenchOpen })),

  setWorkbenchTab: (tab) => set({ workbenchTab: tab, workbenchOpen: true }),
});
