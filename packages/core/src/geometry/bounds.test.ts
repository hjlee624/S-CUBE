import type { Bounds, NEntity } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { entityBounds, mergeBounds } from './bounds.ts';

function expectBoundsClose(actual: Bounds | null, expected: Bounds, digits = 9): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expect(actual.minX).toBeCloseTo(expected.minX, digits);
  expect(actual.minY).toBeCloseTo(expected.minY, digits);
  expect(actual.maxX).toBeCloseTo(expected.maxX, digits);
  expect(actual.maxY).toBeCloseTo(expected.maxY, digits);
}

const base = { handle: 'H', layer: '0' } as const;

describe('entityBounds — 원호 사분점', () => {
  it('사분점을 지나지 않는 원호(-45°→45°)는 끝점 + 0° 사분점만 포함', () => {
    const e: NEntity = {
      kind: 'arc',
      ...base,
      center: { x: 0, y: 0 },
      r: 1,
      a0: -Math.PI / 4,
      a1: Math.PI / 4,
    };
    const c = Math.SQRT1_2;
    expectBoundsClose(entityBounds(e), { minX: c, minY: -c, maxX: 1, maxY: c });
  });

  it('상반원(0→π)은 90° 사분점 포함 → maxY = r', () => {
    const e: NEntity = { kind: 'arc', ...base, center: { x: 0, y: 0 }, r: 2, a0: 0, a1: Math.PI };
    expectBoundsClose(entityBounds(e), { minX: -2, minY: 0, maxX: 2, maxY: 2 });
  });

  it('3/4 원호(0→3π/2)는 π/2·π 사분점 포함', () => {
    const e: NEntity = {
      kind: 'arc',
      ...base,
      center: { x: 5, y: 5 },
      r: 1,
      a0: 0,
      a1: (3 * Math.PI) / 2,
    };
    expectBoundsClose(entityBounds(e), { minX: 4, minY: 4, maxX: 6, maxY: 6 });
  });
});

describe('entityBounds — 기타 엔티티', () => {
  it('line', () => {
    const e: NEntity = { kind: 'line', ...base, a: { x: -3, y: 2 }, b: { x: 7, y: -1 } };
    expectBoundsClose(entityBounds(e), { minX: -3, minY: -1, maxX: 7, maxY: 2 });
  });

  it('circle', () => {
    const e: NEntity = { kind: 'circle', ...base, center: { x: 10, y: -5 }, r: 3 };
    expectBoundsClose(entityBounds(e), { minX: 7, minY: -8, maxX: 13, maxY: -2 });
  });

  it('bulge 폴리라인 — 반원 세그먼트가 정점 밖으로 확장 (사분점 반영)', () => {
    // (0,0)→(2,0) bulge=1 (CCW 반원, 중심 (1,0)) → 호가 (1,-1)까지 내려간다
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 },
        { p: { x: 2, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    expectBoundsClose(entityBounds(e), { minX: 0, minY: -1, maxX: 2, maxY: 0 });
  });

  it('빈 폴리라인 → null', () => {
    const e: NEntity = { kind: 'polyline', ...base, vertices: [], closed: false };
    expect(entityBounds(e)).toBeNull();
  });

  it('text는 삽입점만', () => {
    const e: NEntity = { kind: 'text', ...base, pos: { x: 1, y: 2 }, value: 'x', height: 5 };
    expectBoundsClose(entityBounds(e), { minX: 1, minY: 2, maxX: 1, maxY: 2 });
  });
});

describe('entityBounds — 손상 좌표 방어(중복 안전장치)', () => {
  const HUGE = 1e305;

  it('비유한·초과 정점은 bounds에서 제외 — 정상 정점만 반영', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: HUGE, y: Number.NaN }, bulge: 0 },
        { p: { x: 10, y: 20 }, bulge: 0 },
      ],
      closed: false,
    };
    expectBoundsClose(entityBounds(e), { minX: 0, minY: 0, maxX: 10, maxY: 20 });
  });

  it('모든 정점 손상 → null', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: HUGE, y: 0 }, bulge: 0 },
        { p: { x: 0, y: Number.POSITIVE_INFINITY }, bulge: 0 },
      ],
      closed: false,
    };
    expect(entityBounds(e)).toBeNull();
  });

  it('line 끝점 손상 → 남은 점만, 둘 다 손상이면 null', () => {
    const e: NEntity = { kind: 'line', ...base, a: { x: 3, y: 4 }, b: { x: HUGE, y: 0 } };
    expectBoundsClose(entityBounds(e), { minX: 3, minY: 4, maxX: 3, maxY: 4 });
    const both: NEntity = { kind: 'line', ...base, a: { x: HUGE, y: 0 }, b: { x: 0, y: HUGE } };
    expect(entityBounds(both)).toBeNull();
  });

  it('circle 손상 중심 → null', () => {
    const e: NEntity = { kind: 'circle', ...base, center: { x: HUGE, y: 0 }, r: 1 };
    expect(entityBounds(e)).toBeNull();
  });

  it('text 손상 삽입점 → null', () => {
    const e: NEntity = {
      kind: 'text',
      ...base,
      pos: { x: Number.NaN, y: 0 },
      value: 'x',
      height: 1,
    };
    expect(entityBounds(e)).toBeNull();
  });
});

describe('mergeBounds', () => {
  it('null 무시하고 병합', () => {
    const merged = mergeBounds([
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      null,
      { minX: -2, minY: 0.5, maxX: 0.5, maxY: 3 },
    ]);
    expect(merged).toEqual({ minX: -2, minY: 0, maxX: 1, maxY: 3 });
  });

  it('전부 null → null', () => {
    expect(mergeBounds([null, null])).toBeNull();
    expect(mergeBounds([])).toBeNull();
  });
});
