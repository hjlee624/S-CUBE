/**
 * 캘리브레이션 슬라이스 — 2점 수집 → 실거리 입력 대기 → 확정·저장 (P1-10, P1-13).
 */
import type { StateCreator } from 'zustand';
import { saveCalibration } from '../lib/storage.ts';
import type { AppState, CalibrationSlice } from './types.ts';

export const createCalibrationSlice: StateCreator<AppState, [], [], CalibrationSlice> = (
  set,
  get,
) => ({
  calibration: null,
  calibPoints: [],
  pendingCalibration: null,
  dimCheck: null,

  addCalibPoint: (p) => {
    const { calibPoints } = get();
    const first = calibPoints[0];
    if (first === undefined) {
      set({ calibPoints: [p] });
      return;
    }
    const drawingDistance = Math.hypot(p.x - first.x, p.y - first.y);
    if (drawingDistance <= 0) {
      get().showToast('두 점이 같습니다 — 다른 점을 선택하세요', 'warn');
      return;
    }
    set({ pendingCalibration: { p1: first, p2: p, drawingDistance }, calibPoints: [] });
  },

  cancelCalibration: () => set({ calibPoints: [], pendingCalibration: null }),

  applyCalibration: (cal) => {
    const { storageKey } = get();
    if (storageKey !== null) saveCalibration(storageKey, cal);
    set({ calibration: cal, pendingCalibration: null, calibPoints: [], activeTool: 'pan' });
  },

  clearCalibration: () => set({ calibration: null, dimCheck: null }),

  setDimCheck: (check) => set({ dimCheck: check }),
});
