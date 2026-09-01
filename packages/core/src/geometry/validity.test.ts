import type { PVertex } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { isSelfIntersecting } from './validity.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

describe('isSelfIntersecting', () => {
  it('나비형(bowtie) → true', () => {
    // (0,0)(10,10)(10,0)(0,10) — 폐합 시 대각선이 교차
    const bowtie = [pv(0, 0), pv(10, 10), pv(10, 0), pv(0, 10)];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it('볼록 정사각형 → false', () => {
    const sq = [pv(0, 0), pv(10, 0), pv(10, 10), pv(0, 10)];
    expect(isSelfIntersecting(sq)).toBe(false);
  });

  it('오목(L자) 단순 다각형 → false', () => {
    const lshape = [pv(0, 0), pv(10, 0), pv(10, 4), pv(4, 4), pv(4, 10), pv(0, 10)];
    expect(isSelfIntersecting(lshape)).toBe(false);
  });

  it('삼각형 이하 → false (교차 불가)', () => {
    expect(isSelfIntersecting([pv(0, 0), pv(1, 0), pv(0, 1)])).toBe(false);
    expect(isSelfIntersecting([pv(0, 0), pv(1, 0)])).toBe(false);
    expect(isSelfIntersecting([])).toBe(false);
  });

  it('별(오각별 유사) 교차 도형 → true', () => {
    const star = [pv(0, 0), pv(4, 8), pv(8, 0), pv(0, 5), pv(8, 5)];
    expect(isSelfIntersecting(star)).toBe(true);
  });
});
