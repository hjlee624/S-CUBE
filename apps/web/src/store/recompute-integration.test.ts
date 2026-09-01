/**
 * 재계산 의존 통합 테스트 (P4-10) — 측정·측점 원본 변경 시 하위 산출 항목이 갱신되는지.
 *
 * 이전 결함: recomputeTakeoff 가 규격 변경(SpecMaster)에서만 호출되어, 측정·측점을 바꿔도
 * 하위 항목 quantity 가 갱신되지 않았다. 이 테스트는 실제 스토어 액션(updateSectionArea,
 * updateMeasurementLabel via 값 변경)이 항목 quantity 를 자동 갱신하는지 실경로로 검증한다.
 *
 * 순수 노드 환경(jsdom 불필요) — 슬라이스 조합을 index.ts 와 동일하게 새 store 인스턴스로
 * 만들어 테스트 간 격리한다.
 */
import type { Measurement } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { TakeoffDraft } from '../lib/takeoff-derive.ts';
import { createCalibrationSlice } from './calibration-slice.ts';
import { createDrawingSlice } from './drawing-slice.ts';
import { createMeasurementSlice } from './measurement-slice.ts';
import { createProjectSlice } from './project-slice.ts';
import { createSpecSlice } from './spec-slice.ts';
import { createStationSlice } from './station-slice.ts';
import { createTakeoffSlice } from './takeoff-slice.ts';
import type { AppState } from './types.ts';
import { createUiSlice } from './ui-slice.ts';
import { createViewportSlice } from './viewport-slice.ts';
import { createWorkspaceSlice } from './workspace-slice.ts';

/** index.ts 와 동일한 슬라이스 조합의 격리된 store */
function makeStore() {
  return create<AppState>()((...args) => ({
    ...createDrawingSlice(...args),
    ...createViewportSlice(...args),
    ...createCalibrationSlice(...args),
    ...createUiSlice(...args),
    ...createWorkspaceSlice(...args),
    ...createMeasurementSlice(...args),
    ...createStationSlice(...args),
    ...createSpecSlice(...args),
    ...createTakeoffSlice(...args),
    ...createProjectSlice(...args),
  }));
}

function meas(id: string, value: number): Measurement {
  return {
    id,
    drawingId: 'd1',
    kind: 'length',
    value,
    rawValue: value,
    method: 'manual',
    sourceHandles: [],
    label: id,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function section(id: string, no: number, area_m2: number) {
  return {
    id,
    station: { raw: `No.${no}+0.000`, no, plus_m: 0, chainage_m: no * 20, discontinuity: null },
    itemKey: '절토',
    area_m2,
  };
}

describe('측점 단면적 변경 → 구간 체적 항목 자동 재계산 (P4-10)', () => {
  it('updateSectionArea 후 segment-volume 항목 quantity 가 바뀐다', () => {
    const store = makeStore();
    // 초기: 두 단면 (10, 20) → 체적 = (10+20)/2*20 = 300.
    store.setState({ sections: [section('s1', 8, 10), section('s2', 9, 20)] });
    const draft: TakeoffDraft = {
      id: 'cut',
      workType: '토공사',
      name: '절토량',
      specCode: '',
      unit: '㎥',
      source: { kind: 'segment-volume', itemKey: '절토' },
      sourceRefs: [],
    };
    store.getState().addTakeoffItem(draft);
    expect(store.getState().items[0]?.quantity).toBeCloseTo(300, 9);

    // 단면적 s2 를 20 → 40 으로 편집 → 체적 = (10+40)/2*20 = 500.
    store.getState().updateSectionArea('s2', 40);
    expect(store.getState().items[0]?.quantity).toBeCloseTo(500, 9);
  });

  it('removeSection 으로 구간이 사라지면 재계산된다', () => {
    const store = makeStore();
    store.setState({
      sections: [section('s1', 8, 10), section('s2', 9, 20), section('s3', 10, 30)],
    });
    store.getState().addTakeoffItem({
      id: 'cut',
      workType: '토공사',
      name: '절토량',
      specCode: '',
      unit: '㎥',
      source: { kind: 'segment-volume', itemKey: '절토' },
      sourceRefs: [],
    });
    // (10+20)/2*20 + (20+30)/2*20 = 300 + 500 = 800.
    expect(store.getState().items[0]?.quantity).toBeCloseTo(800, 9);
    // s3 제거 → 구간 1개만 → 300.
    store.getState().removeSection('s3');
    expect(store.getState().items[0]?.quantity).toBeCloseTo(300, 9);
  });
});

describe('측정값 변경 → 측정 소스 항목 자동 재계산 (P4-10)', () => {
  it('측정을 새 값으로 교체하면 측정 소스 항목 quantity 가 따라간다', () => {
    const store = makeStore();
    store.setState({ measurements: [meas('m1', 100)] });
    store.getState().addTakeoffItem({
      id: 'len',
      workType: '기타',
      name: '연장',
      specCode: '',
      unit: 'm',
      source: { kind: 'measurement', measurementId: 'm1', value: 100, label: 'm1' },
      sourceRefs: [],
    });
    expect(store.getState().items[0]?.quantity).toBeCloseTo(100, 9);

    // 측정 원본을 130 으로 갱신(제거 후 추가로 값 교체) → 항목도 130.
    store.getState().removeMeasurement('m1');
    store.getState().addMeasurement(meas('m1', 130));
    expect(store.getState().items[0]?.quantity).toBeCloseTo(130, 9);
  });
});

describe('참조 항목(P4-9) 연쇄 재계산', () => {
  it('원본 측점 변경이 참조 항목까지 전파된다', () => {
    const store = makeStore();
    store.setState({ sections: [section('s1', 8, 10), section('s2', 9, 20)] });
    store.getState().addTakeoffItem({
      id: 'cut',
      workType: '토공사',
      name: '절토량',
      specCode: '',
      unit: '㎥',
      source: { kind: 'segment-volume', itemKey: '절토' },
      sourceRefs: [],
    });
    // 파생 = 절토량 × 0.5.
    store.getState().addTakeoffItem({
      id: 'derived',
      workType: '토공사',
      name: '파생',
      specCode: '',
      unit: '㎥',
      source: {
        kind: 'ref',
        refItemIds: ['cut'],
        refs: [{ itemId: 'cut', label: '절토량', quantity: 0 }],
        factor: 0.5,
      },
      sourceRefs: [],
    });
    // 초기: 절토 300, 파생 150.
    const byId = () => new Map(store.getState().items.map((it) => [it.id, it.quantity]));
    expect(byId().get('cut')).toBeCloseTo(300, 9);
    expect(byId().get('derived')).toBeCloseTo(150, 9);

    // 단면 편집 → 절토 500, 파생 250 (연쇄).
    store.getState().updateSectionArea('s2', 40);
    expect(byId().get('cut')).toBeCloseTo(500, 9);
    expect(byId().get('derived')).toBeCloseTo(250, 9);
  });
});
