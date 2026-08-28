/**
 * 캘리브레이션 순수 로직 테스트 — scale 계산·Zod 검증·치수 대조.
 */
import type { NDimension } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  buildTwoPointCalibration,
  checkDimension,
  computeScale_mPerUnit,
  parseDimensionTextValue,
} from './calibration.ts';

describe('computeScale_mPerUnit', () => {
  it('scale = 실제거리(m) / 도면거리', () => {
    // mm 도면: 10000 도면단위 = 10 m → scale 0.001
    expect(computeScale_mPerUnit(10, 10000)).toBeCloseTo(0.001, 12);
  });

  it('0 이하 거리는 거부한다', () => {
    expect(() => computeScale_mPerUnit(0, 100)).toThrow();
    expect(() => computeScale_mPerUnit(10, 0)).toThrow();
    expect(() => computeScale_mPerUnit(-5, 100)).toThrow();
  });
});

describe('buildTwoPointCalibration', () => {
  it('CalibrationSchema를 통과하는 객체를 만든다', () => {
    const cal = buildTwoPointCalibration(
      { x: 0, y: 0 },
      { x: 3000, y: 4000 },
      5,
      '2026-08-28T00:00:00.000Z',
    );
    expect(cal.method).toBe('two-point');
    expect(cal.drawingDistance).toBeCloseTo(5000, 9); // 3-4-5 삼각형
    expect(cal.scale).toBeCloseTo(0.001, 12);
    expect(cal.calibratedAt).toBe('2026-08-28T00:00:00.000Z');
  });

  it('동일 두 점이면 예외', () => {
    expect(() => buildTwoPointCalibration({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toThrow();
  });
});

describe('parseDimensionTextValue', () => {
  it('숫자·천단위 콤마·단위 접미를 처리한다', () => {
    expect(parseDimensionTextValue('1200')).toBe(1200);
    expect(parseDimensionTextValue('L=1,250.5')).toBeCloseTo(1250.5);
    expect(parseDimensionTextValue('1200mm')).toBe(1200);
  });

  it('"<>"(실측값 표시)와 비수치는 null', () => {
    expect(parseDimensionTextValue('<>')).toBeNull();
    expect(parseDimensionTextValue('참조')).toBeNull();
  });
});

describe('checkDimension (P1-12)', () => {
  const base: Omit<NDimension, 'measuredRaw' | 'textOverride'> = {
    kind: 'dimension',
    handle: 'D1',
    layer: 'DIM',
    defPoints: [],
  };

  it('override 없음 → 오차 0%, 실측 × scale 미터 환산', () => {
    const dim: NDimension = { ...base, measuredRaw: 1200, textOverride: null };
    const check = checkDimension(dim, 0.001);
    expect(check.error_pct).toBe(0);
    expect(check.measured_m).toBeCloseTo(1.2, 12);
    expect(check.hasOverride).toBe(false);
  });

  it('override 존재 → 실측 vs 텍스트 오차 %를 계산한다', () => {
    const dim: NDimension = { ...base, measuredRaw: 1206, textOverride: '1200' };
    const check = checkDimension(dim, 0.001);
    expect(check.hasOverride).toBe(true);
    expect(check.statedValue).toBe(1200);
    expect(check.error_pct).toBeCloseTo(0.5, 9); // (1206-1200)/1200
    expect(check.expected_m).toBeCloseTo(1.2, 12);
    expect(check.measured_m).toBeCloseTo(1.206, 12);
  });

  it('override가 비수치면 실측값으로 폴백한다', () => {
    const dim: NDimension = { ...base, measuredRaw: 500, textOverride: '참조도면' };
    const check = checkDimension(dim, 0.01);
    expect(check.statedValue).toBe(500);
    expect(check.error_pct).toBe(0);
  });
});
