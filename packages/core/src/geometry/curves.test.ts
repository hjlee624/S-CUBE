import type { Vec2 } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { polygonArea } from './area.ts';
import { sampleArc, sampleEllipse, sampleSpline } from './curves.ts';

function bbox(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

describe('sampleArc', () => {
  it('반원(0→π) CCW — 끝점 포함, 반지름 유지', () => {
    const pts = sampleArc({ x: 0, y: 0 }, 10, 0, Math.PI, true);
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0]).toEqual({ x: 10, y: 0 });
    const last = pts[pts.length - 1];
    expect(last?.x).toBeCloseTo(-10, 9);
    expect(last?.y).toBeCloseTo(0, 9);
    // 모든 점이 반지름 10 위
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
  });

  it('완전 원(a0===a1) — 끝점 중복 없이 폐합 근사, 면적 ≈ πr²', () => {
    const pts = sampleArc({ x: 0, y: 0 }, 5, 0, 0, true);
    // 마지막 정점이 첫 정점과 중복되지 않는다
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(first && last && (first.x !== last.x || first.y !== last.y)).toBe(true);
    const area = polygonArea(
      pts.map((p) => ({ p, bulge: 0 })),
      true,
    );
    expect(Math.abs(area - Math.PI * 25) / (Math.PI * 25)).toBeLessThan(1e-3);
  });
});

describe('sampleEllipse', () => {
  it('완전 타원 — bbox = 장반경×단반경, 면적 ≈ π·a·b', () => {
    // major (10,0), ratio 0.5 → a=10, b=5
    const pts = sampleEllipse({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, 0);
    const b = bbox(pts);
    expect(b.minX).toBeCloseTo(-10, 6);
    expect(b.maxX).toBeCloseTo(10, 6);
    expect(b.minY).toBeCloseTo(-5, 6);
    expect(b.maxY).toBeCloseTo(5, 6);
    const area = polygonArea(
      pts.map((p) => ({ p, bulge: 0 })),
      true,
    );
    const expected = Math.PI * 10 * 5;
    expect(Math.abs(area - expected) / expected).toBeLessThan(1e-3);
  });

  it('회전된 타원 — 장축이 대각선', () => {
    // major (0,10) → 장축 수직, ratio 0.5 → 단축 수평 5
    const pts = sampleEllipse({ x: 0, y: 0 }, { x: 0, y: 10 }, 0.5, 0, 0);
    const b = bbox(pts);
    expect(b.maxY).toBeCloseTo(10, 6);
    expect(b.maxX).toBeCloseTo(5, 6);
  });
});

describe('sampleSpline', () => {
  it('clamped 3차 B-spline — de Boor 평가, 끝점이 제어 끝점에 고정', () => {
    const ctrl: Vec2[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    const knots = [0, 0, 0, 0, 1, 1, 1, 1];
    const pts = sampleSpline(ctrl, 3, knots, undefined, false);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    const last = pts[pts.length - 1];
    expect(last?.x).toBeCloseTo(10, 9);
    expect(last?.y).toBeCloseTo(0, 9);
  });

  it('knot 없음 → 제어 다각형 직결 폴백', () => {
    const ctrl: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
    ];
    const pts = sampleSpline(ctrl, 3, undefined, undefined, false);
    expect(pts).toEqual(ctrl);
  });

  it('제어점 0개 → 빈 배열', () => {
    expect(sampleSpline([], 3, undefined, undefined, false)).toEqual([]);
  });
});
