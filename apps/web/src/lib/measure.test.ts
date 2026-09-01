/**
 * 측정 순수 로직 테스트 — 축척² 면적 환산(정확성 핵심)·표시 자리수·다중선택 합산·Measurement 조립.
 * jsdom 불필요(순수 함수만).
 */
import type { Measurement } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  applyScaleToRaw,
  buildMeasurement,
  displayDigits,
  formatMeasureValue,
  measurementsForDrawing,
  sumMeasurements,
  unitLabel,
} from './measure.ts';

describe('applyScaleToRaw — 축척 적용 (면적은 제곱)', () => {
  it('연장은 raw × scale (1제곱)', () => {
    // mm 도면: scale 0.001 (1도면단위 = 0.001m). 도면상 12000단위 = 12 m
    expect(applyScaleToRaw(12000, 'length', 0.001)).toBeCloseTo(12, 12);
  });

  it('면적은 raw × scale² (2제곱) — 정확성 핵심', () => {
    // 도면상 1,000,000 단위²(=1000×1000) × 0.001² = 1 ㎡
    expect(applyScaleToRaw(1_000_000, 'area', 0.001)).toBeCloseTo(1, 12);
  });

  it('scale=1이면 raw 그대로 (면적·연장 동일)', () => {
    expect(applyScaleToRaw(42.5, 'length', 1)).toBe(42.5);
    expect(applyScaleToRaw(42.5, 'area', 1)).toBe(42.5);
  });

  it('면적 환산은 연장 환산의 제곱 관계를 만족한다', () => {
    const scale = 0.02;
    const lenFactor = applyScaleToRaw(1, 'length', scale);
    const areaFactor = applyScaleToRaw(1, 'area', scale);
    expect(areaFactor).toBeCloseTo(lenFactor * lenFactor, 15);
  });

  it('내부 계산은 반올림하지 않는다 (full precision 유지)', () => {
    const v = applyScaleToRaw(1 / 3, 'area', 1 / 7);
    // (1/3) × (1/7)² = 1 / 147
    expect(v).toBeCloseTo(1 / 147, 15);
    expect(v).not.toBe(Number((1 / 147).toFixed(4))); // 표시 반올림값과 다름(정밀 유지)
  });
});

describe('displayDigits · formatMeasureValue — 표시 자리수 정책 (표시만 반올림)', () => {
  it('면적 4자리, 연장 3자리', () => {
    expect(displayDigits('area')).toBe(4);
    expect(displayDigits('length')).toBe(3);
  });

  it('단위 라벨: 면적 ㎡, 연장 m', () => {
    expect(unitLabel('area')).toBe('㎡');
    expect(unitLabel('length')).toBe('m');
  });

  it('면적은 4자리로 반올림 표시', () => {
    expect(formatMeasureValue(12.3456789, 'area')).toBe('12.3457 ㎡');
  });

  it('연장은 3자리로 반올림 표시(0 패딩 포함)', () => {
    expect(formatMeasureValue(4.2, 'length')).toBe('4.200 m');
  });

  it('비유한 값은 — 로 표시', () => {
    expect(formatMeasureValue(Number.NaN, 'area')).toBe('—');
    expect(formatMeasureValue(Number.POSITIVE_INFINITY, 'length')).toBe('—');
  });
});

function m(overrides: Partial<Measurement>): Measurement {
  return {
    id: 'm1',
    drawingId: 'd1',
    kind: 'area',
    value: 1,
    rawValue: 1,
    method: 'polyline',
    sourceHandles: ['A'],
    label: 't',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sumMeasurements — 다중선택 합산', () => {
  it('같은 종류(면적) 값을 full precision으로 합산', () => {
    const r = sumMeasurements([
      { kind: 'area', value: 1.1111 },
      { kind: 'area', value: 2.2222 },
      { kind: 'area', value: 3.3333 },
    ]);
    expect(r).not.toBeNull();
    expect(r?.kind).toBe('area');
    expect(r?.total).toBeCloseTo(6.6666, 12);
  });

  it('연장끼리 합산', () => {
    const r = sumMeasurements([
      { kind: 'length', value: 10 },
      { kind: 'length', value: 5.5 },
    ]);
    expect(r).toEqual({ kind: 'length', total: 15.5 });
  });

  it('면적·연장 혼재면 null (합산 불가)', () => {
    const r = sumMeasurements([
      { kind: 'area', value: 1 },
      { kind: 'length', value: 2 },
    ]);
    expect(r).toBeNull();
  });

  it('빈 목록은 null', () => {
    expect(sumMeasurements([])).toBeNull();
  });
});

describe('measurementsForDrawing — 활성 도면 필터', () => {
  it('activeId와 일치하는 drawingId만 반환', () => {
    const list = [
      m({ id: 'a', drawingId: 'd1' }),
      m({ id: 'b', drawingId: 'd2' }),
      m({ id: 'c', drawingId: 'd1' }),
    ];
    const r = measurementsForDrawing(list, 'd1');
    expect(r.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('activeId가 null이면 빈 배열', () => {
    expect(measurementsForDrawing([m({})], null)).toEqual([]);
  });
});

describe('buildMeasurement — 조립·검증·축척 적용', () => {
  it('면적 측정: value = raw × scale², rawValue 보존', () => {
    const built = buildMeasurement(
      {
        id: 'm1',
        drawingId: 'd1',
        kind: 'area',
        rawValue: 1_000_000,
        method: 'polyline',
        sourceHandles: ['2F'],
        label: '절토부',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      0.001,
    );
    expect(built.value).toBeCloseTo(1, 12); // 1,000,000 × 0.001²
    expect(built.rawValue).toBe(1_000_000); // 원값 보존(검증용)
    expect(built.kind).toBe('area');
    expect(built.sourceHandles).toEqual(['2F']);
    expect(built.holes).toBeUndefined(); // 빈 holes는 생략
  });

  it('연장 측정: value = raw × scale', () => {
    const built = buildMeasurement(
      {
        id: 'm2',
        drawingId: 'd1',
        kind: 'length',
        rawValue: 5000,
        method: 'dimension',
        sourceHandles: ['3A'],
        label: '연장 3A',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      0.001,
    );
    expect(built.value).toBeCloseTo(5, 12);
    expect(built.method).toBe('dimension');
  });

  it('holes가 있으면 보존한다', () => {
    const built = buildMeasurement(
      {
        id: 'm3',
        drawingId: 'd1',
        kind: 'area',
        rawValue: 100,
        method: 'hatch',
        sourceHandles: ['H1'],
        holes: ['H2', 'H3'],
        label: 'x',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      1,
    );
    expect(built.holes).toEqual(['H2', 'H3']);
  });
});
