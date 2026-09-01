/**
 * 캘리브레이션 슬라이스 — 2점 수집 → 실거리 입력 대기 → 확정·저장 (P1-10, P1-13).
 */
import type { StateCreator } from 'zustand';
import { saveCalibration } from '../lib/storage.ts';
import { clearForDrawing, recomputeValuesForDrawing } from './measurement-slice.ts';
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
    const { storageKey, activeId, measurements } = get();
    if (storageKey !== null) saveCalibration(storageKey, cal);
    // 재캘리브레이션 대비: 기존 측정의 value 는 측정 당시 축척으로 고정돼 있으므로,
    // 활성 도면 측정들을 보존된 rawValue 에서 새 축척으로 되계산해 옛/새 축척 혼재를 막는다
    // (MeasurePanel·합산은 value 를 직접 쓰므로 되계산 없이는 하류 수량이 전부 틀어진다).
    const nextMeasurements =
      activeId === null
        ? measurements
        : recomputeValuesForDrawing(measurements, activeId, cal.scale);
    set({
      calibration: cal,
      measurements: nextMeasurements,
      pendingCalibration: null,
      calibPoints: [],
      activeTool: 'pan',
    });
    // P4-10: 재캘리브레이션으로 측정 value 가 바뀌면 하위 산출 항목도 재계산.
    get().recomputeTakeoff();
  },

  clearCalibration: () => {
    const { activeId, measurements } = get();
    // 축척이 사라지면 활성 도면 측정의 value 는 되계산할 기준이 없어 무의미해진다
    // (측정 도구도 캘리브레이션 없이는 비활성). 옛 축척 값이 남아 오독되지 않도록 함께 제거한다.
    const nextMeasurements =
      activeId === null ? measurements : clearForDrawing(measurements, activeId);
    set({
      calibration: null,
      dimCheck: null,
      measurements: nextMeasurements,
      selectedMeasurementIds: [],
    });
    // P4-10: 활성 도면 측정이 제거되면 그 측정을 소스로 쓰던 항목도 재계산.
    get().recomputeTakeoff();
  },

  setDimCheck: (check) => set({ dimCheck: check }),
});
