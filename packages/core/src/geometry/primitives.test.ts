import type { PVertex } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { bulgeToArc, distance, polylineLength } from './primitives.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

describe('distance', () => {
  it('3-4-5 삼각형', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 12);
  });
});

describe('bulgeToArc — 해석해 대조 (1e-9 이내)', () => {
  it('반원 bulge=1: (0,0)→(2,0) → 중심 (1,0), r=1, CCW', () => {
    const arc = bulgeToArc({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expect(arc.center.x).toBeCloseTo(1, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
    expect(arc.r).toBeCloseTo(1, 9);
    expect(arc.ccw).toBe(true);
    expect(arc.a0).toBeCloseTo(Math.PI, 9);
    expect(arc.a1).toBeCloseTo(0, 9);
  });

  it('사분원 bulge=tan(π/8): 단위원 (1,0)→(0,1) → 중심 (0,0), r=1', () => {
    const arc = bulgeToArc({ x: 1, y: 0 }, { x: 0, y: 1 }, Math.tan(Math.PI / 8));
    expect(arc.center.x).toBeCloseTo(0, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
    expect(arc.r).toBeCloseTo(1, 9);
    expect(arc.ccw).toBe(true);
    expect(arc.a0).toBeCloseTo(0, 9);
    expect(arc.a1).toBeCloseTo(Math.PI / 2, 9);
  });

  it('음수 bulge(CW): (1,0)→(0,1), bulge=-tan(π/8) → 중심 (1,1)', () => {
    const arc = bulgeToArc({ x: 1, y: 0 }, { x: 0, y: 1 }, -Math.tan(Math.PI / 8));
    expect(arc.center.x).toBeCloseTo(1, 9);
    expect(arc.center.y).toBeCloseTo(1, 9);
    expect(arc.r).toBeCloseTo(1, 9);
    expect(arc.ccw).toBe(false);
  });

  it('bulge > 1 (포함각 > π): 중심이 현 반대편', () => {
    // 3/4원: θ = 3π/2, bulge = tan(3π/8). 단위원 (1,0)→(0,-1) CCW
    const arc = bulgeToArc({ x: 1, y: 0 }, { x: 0, y: -1 }, Math.tan((3 * Math.PI) / 8));
    expect(arc.center.x).toBeCloseTo(0, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
    expect(arc.r).toBeCloseTo(1, 9);
  });

  it('bulge=0은 예외', () => {
    expect(() => bulgeToArc({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toThrow(/bulge/);
  });
});

describe('polylineLength', () => {
  it('100×100 정사각형 폐합 → 400', () => {
    const square = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    expect(polylineLength(square, true)).toBeCloseTo(400, 12);
  });

  it('열린 폴리라인은 마지막 변 제외 → 300', () => {
    const square = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    expect(polylineLength(square, false)).toBeCloseTo(300, 12);
  });

  it('반원 bulge=1 호장 = πr (r=50)', () => {
    const half = [pv(0, 0, 1), pv(100, 0)];
    expect(polylineLength(half, false)).toBeCloseTo(Math.PI * 50, 9);
  });

  it('폐합 반원(반원 + 지름) = πr + 2r', () => {
    const half = [pv(0, 0, 1), pv(100, 0)];
    expect(polylineLength(half, true)).toBeCloseTo(Math.PI * 50 + 100, 9);
  });

  it('열린 폴리라인 마지막 정점의 bulge는 무시', () => {
    const open = [pv(0, 0), pv(100, 0, 5)];
    expect(polylineLength(open, false)).toBeCloseTo(100, 12);
  });

  it('정점 2개 미만 → 0', () => {
    expect(polylineLength([], true)).toBe(0);
    expect(polylineLength([pv(1, 1)], true)).toBe(0);
  });
});
