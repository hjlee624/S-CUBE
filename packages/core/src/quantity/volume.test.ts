import { describe, expect, it } from 'vitest';
import { averageEndArea } from './volume.ts';

describe('averageEndArea (양단면평균법)', () => {
  it('V = (A1+A2)/2 × L', () => {
    expect(averageEndArea(10, 20, 20)).toBe(300);
  });

  it('연장 0 (전/후 불연속 구간) → 체적 0', () => {
    expect(averageEndArea(15.5, 42.1, 0)).toBe(0);
  });

  it('반올림 없이 full precision 유지', () => {
    expect(averageEndArea(1.111, 2.222, 3.3)).toBeCloseTo(((1.111 + 2.222) / 2) * 3.3, 12);
  });
});
