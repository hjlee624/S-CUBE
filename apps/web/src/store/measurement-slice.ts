/**
 * 측정 슬라이스 (P2-10) — 측정 결과 목록·선택 상태.
 *
 * measurements[]는 전 도면 측정을 drawingId 태깅으로 함께 보관한다(ScubeProject 구조 일치).
 * 표시·합산은 활성 도면(activeId) 것만 필터한다(lib/measure.ts measurementsForDrawing).
 *
 * 순수 상태 전이(추가·삭제·라벨수정·선택토글·도면별 제거)는 아래 순수 함수로 분리해 테스트한다.
 * 이 슬라이스는 canvas를 import하지 않는다(측정 pick의 canvas 호출은 canvas/actions.ts 오케스트레이터).
 */
import type { Measurement } from '@s-cube/schema';
import type { StateCreator } from 'zustand';
import { applyScaleToRaw } from '../lib/measure.ts';
import type { AppState, MeasurementSlice } from './types.ts';

/** 측정 추가 — 배열 끝에 append (순수) */
export function addMeasurement(list: Measurement[], m: Measurement): Measurement[] {
  return [...list, m];
}

/**
 * 재캘리브레이션 시 특정 도면 측정들의 value 재계산 (순수) —
 * 각 Measurement.value 는 측정 당시 축척으로 고정돼 있으므로, 축척이 바뀌면
 * 보존된 rawValue 에서 새 축척으로 되계산해야 옛/새 축척이 섞이지 않는다.
 * (area 는 scale², length 는 scale — applyScaleToRaw 가 kind로 분기.)
 * drawingId 가 일치하지 않는(다른 도면) 측정은 그대로 둔다(캘리브레이션은 도면별).
 */
export function recomputeValuesForDrawing(
  list: Measurement[],
  drawingId: string,
  scale_mPerUnit: number,
): Measurement[] {
  return list.map((m) =>
    m.drawingId === drawingId
      ? { ...m, value: applyScaleToRaw(m.rawValue, m.kind, scale_mPerUnit) }
      : m,
  );
}

/** 측정 제거 (순수) */
export function removeMeasurement(list: Measurement[], id: string): Measurement[] {
  return list.filter((m) => m.id !== id);
}

/** 라벨(명명) 수정 — 해당 id만 교체 (순수) */
export function updateLabel(list: Measurement[], id: string, label: string): Measurement[] {
  return list.map((m) => (m.id === id ? { ...m, label } : m));
}

/** 특정 도면의 측정 일괄 제거 (도면 닫힘) (순수) */
export function clearForDrawing(list: Measurement[], drawingId: string): Measurement[] {
  return list.filter((m) => m.drawingId !== drawingId);
}

/** 선택 토글 — 있으면 제거, 없으면 추가 (순수, Shift 다중선택) */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

export const createMeasurementSlice: StateCreator<AppState, [], [], MeasurementSlice> = (
  set,
  get,
) => ({
  measurements: [],
  selectedMeasurementIds: [],

  addMeasurement: (m) => {
    set((s) => ({
      measurements: addMeasurement(s.measurements, m),
      // 새로 추가된 측정을 단일 선택으로 만들어 즉시 하이라이트·미리보기
      selectedMeasurementIds: [m.id],
    }));
    get().recomputeTakeoff();
    get().addHistoryEntry({
      actor: get().author || '사용자',
      kind: 'measurement',
      targetId: m.id,
      detail: `측정 추가: ${m.label}`,
    });
  },

  removeMeasurement: (id) => {
    const m = get().measurements.find((x) => x.id === id);
    set((s) => ({
      measurements: removeMeasurement(s.measurements, id),
      selectedMeasurementIds: s.selectedMeasurementIds.filter((sid) => sid !== id),
    }));
    get().recomputeTakeoff();
    if (m !== undefined) {
      get().addHistoryEntry({
        actor: get().author || '사용자',
        kind: 'measurement',
        targetId: id,
        detail: `측정 삭제: ${m.label}`,
      });
    }
  },

  updateMeasurementLabel: (id, label) => {
    set((s) => ({ measurements: updateLabel(s.measurements, id, label) }));
    get().recomputeTakeoff();
  },

  clearMeasurementsForDrawing: (drawingId) => {
    set((s) => ({
      measurements: clearForDrawing(s.measurements, drawingId),
      selectedMeasurementIds: [],
    }));
    get().recomputeTakeoff();
  },

  selectMeasurement: (id) => set({ selectedMeasurementIds: id === null ? [] : [id] }),

  toggleMeasurementSelection: (id) =>
    set((s) => ({ selectedMeasurementIds: toggleSelection(s.selectedMeasurementIds, id) })),

  clearMeasurementSelection: () => set({ selectedMeasurementIds: [] }),
});
