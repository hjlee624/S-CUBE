import type { PVertex } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { distancePointToPolyline, distancePointToSegment } from './hittest.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

describe('distancePointToSegment', () => {
  it('수직 거리 — 세그먼트 중앙 위쪽', () => {
    const d = distancePointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(3, 12);
  });

  it('끝점 밖 → 끝점까지 거리로 clamp', () => {
    const d = distancePointToSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d).toBeCloseTo(4, 12);
    const d2 = distancePointToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(d2).toBeCloseTo(5, 12); // (3,4) 대각
  });

  it('세그먼트 위 점 → 0', () => {
    expect(distancePointToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(
      0,
      12,
    );
  });

  it('길이 0 퇴화 세그먼트 → 점까지 거리', () => {
    expect(distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(
      5,
      12,
    );
  });
});

describe('distancePointToPolyline', () => {
  it('직선 폴리라인 최소 거리', () => {
    const line = [pv(0, 0), pv(10, 0), pv(10, 10)];
    expect(distancePointToPolyline({ x: 5, y: 2 }, line, false)).toBeCloseTo(2, 12);
    expect(distancePointToPolyline({ x: 8, y: 5 }, line, false)).toBeCloseTo(2, 12);
  });

  it('closed=true 이면 폐합 변까지 포함', () => {
    const tri = [pv(0, 0), pv(10, 0), pv(0, 10)];
    // 폐합변 (0,10)→(0,0) 은 x=0 축, 점 (-1,5) 까지 거리 1
    expect(distancePointToPolyline({ x: -1, y: 5 }, tri, true)).toBeCloseTo(1, 12);
  });

  it('bulge 원호 근사 — 반원 위 점 거리 ≈ 0', () => {
    // (0,0)→(100,0) 반원 bulge=1, 중심(50,0), r=50. 원호 위 점 (50,-50) 근처
    const arc = [pv(0, 0, 1), pv(100, 0)];
    const d = distancePointToPolyline({ x: 50, y: -50 }, arc, false);
    // 근사 분할 오차 — r=50 반원을 15조각으로 나눈 중앙 sag ≈ r(1−cos(π/30)) ≈ 0.27
    expect(d).toBeLessThan(0.5);
  });

  it('빈/단일 정점', () => {
    expect(distancePointToPolyline({ x: 0, y: 0 }, [], false)).toBe(Number.POSITIVE_INFINITY);
    expect(distancePointToPolyline({ x: 3, y: 4 }, [pv(0, 0)], false)).toBeCloseTo(5, 12);
  });
});
