import type { Loop, PVertex } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  bulgeSegmentArea,
  hatchArea,
  isImplicitlyClosed,
  netAreaWithHoles,
  pointInPolygon,
  polygonArea,
  polygonSignedArea,
  signedArea,
} from './area.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

describe('signedArea — 해석해 대조', () => {
  it('단위 정사각형 CCW → +1', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(signedArea(sq)).toBeCloseTo(1, 12);
  });

  it('단위 정사각형 CW → −1', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(signedArea(sq)).toBeCloseTo(-1, 12);
  });

  it('삼각형 (0,0)(4,0)(0,3) → +6', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    expect(signedArea(tri)).toBeCloseTo(6, 12);
  });

  it('정점 2개 이하 → 0', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([{ x: 1, y: 1 }])).toBe(0);
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });
});

describe('bulgeSegmentArea — 해석해 대조 (1e-9 이내)', () => {
  it('반원 bulge=1: (0,0)→(2,0), r=1 → 활꼴 = πr²/2 = π/2', () => {
    expect(bulgeSegmentArea({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('사분원 bulge=tan(π/8): 단위 현 (1,0)→(0,1) → ½r²(θ−sinθ), θ=π/2', () => {
    const b = Math.tan(Math.PI / 8);
    const expected = 0.5 * (Math.PI / 2 - 1); // r=1
    expect(bulgeSegmentArea({ x: 1, y: 0 }, { x: 0, y: 1 }, b)).toBeCloseTo(expected, 9);
  });

  it('bulge 부호 반전 → 활꼴 면적 부호 반전', () => {
    const a = bulgeSegmentArea({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    const b = bulgeSegmentArea({ x: 0, y: 0 }, { x: 2, y: 0 }, -1);
    expect(b).toBeCloseTo(-a, 9);
  });

  it('bulge=0 또는 동일점 → 0', () => {
    expect(bulgeSegmentArea({ x: 0, y: 0 }, { x: 2, y: 0 }, 0)).toBe(0);
    expect(bulgeSegmentArea({ x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toBe(0);
  });
});

describe('polygonArea / polygonSignedArea — 해석해 대조 (1e-9 이내)', () => {
  it('100×100 정사각형 → 10000', () => {
    const sq = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    expect(polygonArea(sq, true)).toBeCloseTo(10000, 9);
  });

  it('CW 정사각형도 절대 면적 → 10000', () => {
    const sq = [pv(0, 0), pv(0, 100), pv(100, 100), pv(100, 0)];
    expect(polygonArea(sq, true)).toBeCloseTo(10000, 9);
    expect(polygonSignedArea(sq, true)).toBeCloseTo(-10000, 9);
  });

  it('폐합 반원 도형 (반원 bulge=1 + 지름) → πr²/2, r=50 → π·1250', () => {
    const semi = [pv(0, 0, 1), pv(100, 0)];
    expect(polygonArea(semi, true)).toBeCloseTo((Math.PI * 2500) / 2, 9);
  });

  it('두 반원 bulge=1 → 완전 원 πr², r=50 → π·2500', () => {
    const circ = [pv(0, 0, 1), pv(100, 0, 1)];
    expect(polygonArea(circ, true)).toBeCloseTo(Math.PI * 2500, 9);
  });

  it('사분원 bulge=tan(π/8) 포함 도형: 부채꼴 = πr²/4, r=1 (원점 중심)', () => {
    // (0,0)→(1,0) 직선, (1,0)→(0,1) 사분호(bulge=tan(π/8)), (0,1)→(0,0) 직선
    // = 원점 중심 단위원 사분 부채꼴 → π/4
    const b = Math.tan(Math.PI / 8);
    const sector = [pv(0, 0), pv(1, 0, b), pv(0, 1)];
    expect(polygonArea(sector, true)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('직선 근사: 열린 폴리라인은 자동 폐합해 면적', () => {
    const open = [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)];
    expect(polygonArea(open, false)).toBeCloseTo(100, 9);
  });

  it('정점 3개 미만 → 0', () => {
    expect(polygonArea([pv(0, 0), pv(1, 0)], true)).toBe(0);
  });
});

describe('isImplicitlyClosed', () => {
  it('closed=false 이고 시점≠종점이면 true', () => {
    const open = [pv(0, 0), pv(10, 0), pv(10, 10)];
    expect(isImplicitlyClosed(open, false)).toBe(true);
  });

  it('closed=true 이면 항상 false', () => {
    const poly = [pv(0, 0), pv(10, 0), pv(10, 10)];
    expect(isImplicitlyClosed(poly, true)).toBe(false);
  });

  it('시점=종점이면 false (이미 폐합)', () => {
    const poly = [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 0)];
    expect(isImplicitlyClosed(poly, false)).toBe(false);
  });
});

describe('pointInPolygon — ray casting', () => {
  const square = [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)];

  it('내부 점 → true', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('외부 점 → false', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false);
  });

  it('경계 위 점 → true (tolerance)', () => {
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 10 }, square)).toBe(true);
  });

  it('bulge 반원 도형 내부/외부', () => {
    // (0,0)→(100,0) 반원 bulge=1(하단), 폐합 → 하반원 영역, 중심(50,0), r=50
    const semi = [pv(0, 0, 1), pv(100, 0)];
    expect(pointInPolygon({ x: 50, y: -25 }, semi)).toBe(true); // 하반원 내부
    expect(pointInPolygon({ x: 50, y: 25 }, semi)).toBe(false); // 상단(외부)
  });
});

describe('netAreaWithHoles — even-odd 구멍 차감', () => {
  it('큰 사각형 100×100 − 작은 사각형 20×20 구멍 → 10000 − 400 = 9600', () => {
    const outer = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    const hole = [pv(40, 40), pv(60, 40), pv(60, 60), pv(40, 60)];
    expect(netAreaWithHoles(outer, [hole])).toBeCloseTo(9600, 9);
  });

  it('구멍 여러 개 차감', () => {
    const outer = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    const h1 = [pv(10, 10), pv(20, 10), pv(20, 20), pv(10, 20)];
    const h2 = [pv(80, 80), pv(90, 80), pv(90, 90), pv(80, 90)];
    expect(netAreaWithHoles(outer, [h1, h2])).toBeCloseTo(10000 - 200, 9);
  });

  it('구멍이 외곽보다 크면 0 클램프', () => {
    const outer = [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)];
    const hole = [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)];
    expect(netAreaWithHoles(outer, [hole])).toBe(0);
  });
});

describe('hatchArea — 외곽 − 내부 루프', () => {
  it('외곽 사각형 − 내부 루프 → 차감', () => {
    const loops: Loop[] = [
      { vertices: [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)], isOuter: true },
      { vertices: [pv(40, 40), pv(60, 40), pv(60, 60), pv(40, 60)], isOuter: false },
    ];
    expect(hatchArea(loops)).toBeCloseTo(9600, 9);
  });

  it('외곽만 있으면 그 면적', () => {
    const loops: Loop[] = [
      { vertices: [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)], isOuter: true },
    ];
    expect(hatchArea(loops)).toBeCloseTo(100, 9);
  });

  it('내부 루프가 외곽보다 크면 0 클램프', () => {
    const loops: Loop[] = [
      { vertices: [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)], isOuter: true },
      { vertices: [pv(0, 0), pv(100, 0), pv(100, 100), pv(0, 100)], isOuter: false },
    ];
    expect(hatchArea(loops)).toBe(0);
  });
});
