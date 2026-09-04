/**
 * 캘리브레이션 슬라이스 테스트 (RW-23) — 축척 재사용·직전 축척 보존.
 *
 * 순수 노드 환경(jsdom 불필요): storageKey=null 이면 localStorage 를 건드리지 않으므로
 * saveCalibration 부수효과 없이 상태 전이만 검증한다.
 */
import type { Calibration, Measurement } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
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

function cal(scale: number): Calibration {
  return {
    method: 'two-point',
    p1: { x: 0, y: 0 },
    p2: { x: 100, y: 0 },
    drawingDistance: 100,
    realDistance_m: 100 * scale,
    scale,
    calibratedAt: '2026-01-01T00:00:00.000Z',
  };
}

function areaMeas(id: string, rawValue: number): Measurement {
  return {
    id,
    drawingId: 'd1',
    kind: 'area',
    value: rawValue,
    rawValue,
    method: 'polyline',
    sourceHandles: [],
    label: id,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('applyCalibration — 직전 축척 보존 (RW-23)', () => {
  it('applyCalibration 은 lastCalibration 을 함께 기록한다', () => {
    const store = makeStore();
    store.setState({ activeId: 'd1', storageKey: null });
    store.getState().applyCalibration(cal(2));
    expect(store.getState().calibration?.scale).toBe(2);
    expect(store.getState().lastCalibration?.scale).toBe(2);
  });
});

describe('reuseCalibration — 2점 재측정 없이 축척 적용 (RW-23)', () => {
  it('활성 도면에 축척을 적용하고 lastCalibration 을 갱신한다', () => {
    const store = makeStore();
    store.setState({ activeId: 'd1', storageKey: null });
    store.getState().reuseCalibration(cal(3));
    expect(store.getState().calibration?.scale).toBe(3);
    expect(store.getState().lastCalibration?.scale).toBe(3);
  });

  it('활성 도면 면적 측정값을 재사용 축척²으로 되계산한다', () => {
    const store = makeStore();
    store.setState({
      activeId: 'd1',
      storageKey: null,
      measurements: [areaMeas('m1', 10)],
    });
    store.getState().reuseCalibration(cal(2));
    // area 는 scale² → 10 × 2² = 40
    const m = store.getState().measurements.find((x) => x.id === 'm1');
    expect(m?.value).toBe(40);
    expect(m?.rawValue).toBe(10); // 원값 보존
  });

  it('다른 도면 측정값은 건드리지 않는다', () => {
    const store = makeStore();
    const other: Measurement = { ...areaMeas('m2', 5), drawingId: 'd2' };
    store.setState({ activeId: 'd1', storageKey: null, measurements: [other] });
    store.getState().reuseCalibration(cal(2));
    const m = store.getState().measurements.find((x) => x.id === 'm2');
    expect(m?.value).toBe(5); // d2 측정은 그대로
  });
});
