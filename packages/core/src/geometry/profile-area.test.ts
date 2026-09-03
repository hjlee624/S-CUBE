import type { PVertex } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { areaBetweenProfiles } from './profile-area.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

describe('areaBetweenProfiles — 절토(원지반 위)/성토(계획 위) 해석해 대조', () => {
  it('평행 수평선: 원지반 y=10 > 계획 y=0 → cut=1000, fill=0', () => {
    const ground = [pv(0, 10), pv(100, 10)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBeCloseTo(1000, 9);
    expect(r.fill_m2).toBeCloseTo(0, 9);
    expect(r.net_m2).toBeCloseTo(1000, 9);
    expect(r.overlapRange).toEqual([0, 100]);
    expect(r.warnings).toEqual([]);
  });

  it('계획이 위: 원지반 y=0 < 계획 y=10 → fill=1000, cut=0', () => {
    const ground = [pv(0, 0), pv(100, 0)];
    const design = [pv(0, 10), pv(100, 10)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBeCloseTo(0, 9);
    expect(r.fill_m2).toBeCloseTo(1000, 9);
    expect(r.net_m2).toBeCloseTo(-1000, 9);
    expect(r.overlapRange).toEqual([0, 100]);
  });

  it('사다리꼴: 원지반 수평 y=10, 계획 경사 (0,0)→(100,10) → cut=500, fill=0', () => {
    // diff = 10 − 0.1x ≥ 0 전구간 절토. ∫₀¹⁰⁰(10−0.1x)dx = 1000 − 500 = 500.
    const ground = [pv(0, 10), pv(100, 10)];
    const design = [pv(0, 0), pv(100, 10)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBeCloseTo(500, 9);
    expect(r.fill_m2).toBeCloseTo(0, 9);
    expect(r.net_m2).toBeCloseTo(500, 9);
  });

  it('교차 케이스: 원지반 수평 y=0, 계획 대각 (0,-5)→(100,5) → x=50 교차, cut=125·fill=125', () => {
    // 0~50: 계획이 아래(원지반이 위) → 절토 삼각형 ½·50·5 = 125
    // 50~100: 계획이 위 → 성토 삼각형 ½·50·5 = 125
    const ground = [pv(0, 0), pv(100, 0)];
    const design = [pv(0, -5), pv(100, 5)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBeCloseTo(125, 9);
    expect(r.fill_m2).toBeCloseTo(125, 9);
    expect(r.net_m2).toBeCloseTo(0, 9);
    expect(r.overlapRange).toEqual([0, 100]);
  });

  it('교차 케이스(비대칭): 원지반 수평 y=0, 계획 대각 (0,-10)→(100,5)', () => {
    // diff = 0 − (−10 + 0.15x) = 10 − 0.15x. 교차 x = 10/0.15 = 66.666...
    // 절토(0~xc): ½·xc·10 ; 성토(xc~100): ½·(100−xc)·(0.15·100−10)=½·(100−xc)·5
    const ground = [pv(0, 0), pv(100, 0)];
    const design = [pv(0, -10), pv(100, 5)];
    const r = areaBetweenProfiles(ground, design);
    const xc = 10 / 0.15;
    const cut = 0.5 * xc * 10;
    const fill = 0.5 * (100 - xc) * 5;
    expect(r.cut_m2).toBeCloseTo(cut, 9);
    expect(r.fill_m2).toBeCloseTo(fill, 9);
    expect(r.net_m2).toBeCloseTo(cut - fill, 9);
  });

  it('bulge(원호) 프로파일: 원지반 반원 아래로 볼록, 계획 수평 y=0', () => {
    // 원지반 (0,0)→(100,0) bulge=1 → 하단 반원(중심 (50,0), r=50), 곡선은 y=0 아래.
    // 따라서 원지반 y ≤ 0 = 계획 y 전구간 → 전부 성토, 면적 = 반원 πr²/2 = π·1250.
    // 원호는 직선 근사(faceting)로 샘플링하므로 상대오차 ≈ 0.01% 이내로 대조한다.
    const exact = (Math.PI * 2500) / 2;
    const ground = [pv(0, 0, 1), pv(100, 0)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBeCloseTo(0, 6);
    expect(Math.abs(r.fill_m2 - exact) / exact).toBeLessThan(2e-4);
    expect(r.overlapRange).toEqual([0, 100]);
  });

  it('bulge 위로 볼록(bulge=-1): 원지반 상단 반원, 계획 수평 y=0 → 전부 절토 πr²/2', () => {
    const exact = (Math.PI * 2500) / 2;
    const ground = [pv(0, 0, -1), pv(100, 0)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.fill_m2).toBeCloseTo(0, 6);
    expect(Math.abs(r.cut_m2 - exact) / exact).toBeLessThan(2e-4);
  });

  it('부분 겹침: 원지반 x 0~100, 계획 x 50~150 → 공통 [50,100] 만 적분', () => {
    // 공통 [50,100] 에서 원지반 y=10, 계획 y=0 → cut = 10·50 = 500.
    const ground = [pv(0, 10), pv(100, 10)];
    const design = [pv(50, 0), pv(150, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.overlapRange).toEqual([50, 100]);
    expect(r.cut_m2).toBeCloseTo(500, 9);
    expect(r.fill_m2).toBeCloseTo(0, 9);
  });

  it('공통 구간 없음: 원지반 x 0~40, 계획 x 60~100 → cut=fill=0, 경고', () => {
    const ground = [pv(0, 10), pv(40, 10)];
    const design = [pv(60, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBe(0);
    expect(r.fill_m2).toBe(0);
    expect(r.net_m2).toBe(0);
    expect(r.overlapRange).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('맞닿기만 함(공통 x 한 점): cut=fill=0, 경고', () => {
    const ground = [pv(0, 10), pv(50, 10)];
    const design = [pv(50, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.cut_m2).toBe(0);
    expect(r.fill_m2).toBe(0);
    expect(r.overlapRange).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('areaBetweenProfiles — 다중 breakpoint / 다구간 부호', () => {
  it('원지반 W자, 계획 수평 y=0: 절토·성토 반복', () => {
    // 원지반: (0,5)(25,-5)(50,5)(75,-5)(100,5) 톱니, 계획 y=0.
    // 각 세그먼트는 기울기 ±0.4, y=0 을 절반 지점에서 교차.
    // 세그먼트별 위/아래 삼각형 면적 = ½·(12.5)·5 = 31.25 (12.5 = x폭 절반).
    // 세그먼트 1 (0,5)→(25,-5): 앞 12.5 절토(양수), 뒤 12.5 성토. 각 31.25.
    // 대칭이므로 총 cut = 성토 fill = 4개 삼각형씩. 각 삼각형 31.25.
    const ground = [pv(0, 5), pv(25, -5), pv(50, 5), pv(75, -5), pv(100, 5)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    // 삼각형 개수: cut 4개(위쪽 반), fill 4개(아래쪽 반) → 각 31.25.
    expect(r.cut_m2).toBeCloseTo(4 * 31.25, 9);
    expect(r.fill_m2).toBeCloseTo(4 * 31.25, 9);
    expect(r.net_m2).toBeCloseTo(0, 9);
  });
});

describe('areaBetweenProfiles — 견고성', () => {
  it('원지반 정점 부족(<2) → 0 + 경고', () => {
    const r = areaBetweenProfiles([pv(0, 0)], [pv(0, 0), pv(100, 0)]);
    expect(r.cut_m2).toBe(0);
    expect(r.fill_m2).toBe(0);
    expect(r.overlapRange).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('비유한 좌표 방어: NaN/Infinity 정점은 무시 + 경고', () => {
    const ground = [pv(0, 10), pv(Number.NaN, 10), pv(100, 10)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    // NaN 정점 제거 후 (0,10)-(100,10) 로 여전히 cut=1000.
    expect(r.cut_m2).toBeCloseTo(1000, 9);
    expect(r.warnings.some((w) => w.includes('비유한'))).toBe(true);
  });

  it('같은 x 다중 y(수직면): 대표값 사용 + 경고', () => {
    // 원지반에 수직면: (50,10)과 (50,20) 두 y. 첫 값(10) 대표. 나머지는 수평 y=10.
    const ground = [pv(0, 10), pv(50, 10), pv(50, 20), pv(100, 10)];
    const design = [pv(0, 0), pv(100, 0)];
    const r = areaBetweenProfiles(ground, design);
    expect(r.warnings.some((w) => w.includes('여러 y'))).toBe(true);
    // 대표값으로 사실상 y=10 수평 → cut≈1000.
    expect(r.cut_m2).toBeCloseTo(1000, 6);
  });
});
