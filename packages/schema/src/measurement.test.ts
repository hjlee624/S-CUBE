import { describe, expect, it } from 'vitest';
import { MeasurementSchema } from './measurement.ts';

describe('MeasurementSchema', () => {
  it('면적 측정(hatch, 구멍 포함) 통과', () => {
    const m = {
      id: 'meas-1',
      drawingId: 'dwg-1',
      kind: 'area',
      value: 96.0,
      rawValue: 9600,
      method: 'hatch',
      sourceHandles: ['1A2B', '1A2C'],
      holes: ['1A2D'],
      label: '절토부',
      createdAt: '2026-08-28T00:00:00.000Z',
    };
    expect(MeasurementSchema.parse(m)).toEqual(m);
  });

  it('연장 측정(polyline, holes 생략) 통과', () => {
    const m = {
      id: 'meas-2',
      drawingId: 'dwg-1',
      kind: 'length',
      value: 12.345,
      rawValue: 12345,
      method: 'polyline',
      sourceHandles: ['2B3C'],
      label: '옹벽 본체',
      createdAt: '2026-08-28T00:00:00.000Z',
    };
    const parsed = MeasurementSchema.parse(m);
    expect(parsed.holes).toBeUndefined();
    expect(parsed.kind).toBe('length');
  });

  it('method 6종 전부 통과', () => {
    const base = {
      id: 'm',
      drawingId: 'd',
      kind: 'area' as const,
      value: 1,
      rawValue: 1,
      sourceHandles: [],
      label: '',
      createdAt: '2026-08-28T00:00:00.000Z',
    };
    for (const method of [
      'polyline',
      'hatch',
      'auto-boundary',
      'entity-chain',
      'dimension',
      'manual',
    ]) {
      expect(MeasurementSchema.safeParse({ ...base, method }).success).toBe(true);
    }
  });

  it('잘못된 kind·method 거부', () => {
    const base = {
      id: 'm',
      drawingId: 'd',
      value: 1,
      rawValue: 1,
      method: 'polyline',
      sourceHandles: [],
      label: '',
      createdAt: '2026-08-28T00:00:00.000Z',
    };
    expect(MeasurementSchema.safeParse({ ...base, kind: 'volume' }).success).toBe(false);
    expect(MeasurementSchema.safeParse({ ...base, kind: 'area', method: 'circle' }).success).toBe(
      false,
    );
  });

  it('필수 필드 누락 거부', () => {
    expect(MeasurementSchema.safeParse({ id: 'm', kind: 'area' }).success).toBe(false);
  });
});
