/**
 * 산출 항목 basis 조립·평가 테스트 (Phase 4-B).
 *
 * 커버: 측정 소스(단순·면적×두께)·구간 체적 소스(정상·blocked)·수동·참조,
 * 규격 환산계수·할증률 체이닝, evaluate 결과가 core 계산과 일치하는지.
 *
 * P4-12 이후 측정·구간 basis 는 fConst 리터럴이 아니라 셀 참조(fRef) 트리이므로,
 * 평가는 evaluatePlain(basis, {sections, measurements}) resolver 경로로 한다.
 */
import type { MaterialSpec, Measurement, Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  buildBasis,
  evaluatePlain,
  type MeasurementSource,
  type SegmentVolumeSource,
} from './takeoff-build.ts';

function station(
  raw: string,
  chainage_m: number,
  discontinuity: Station['discontinuity'] = null,
): Station {
  return { raw, no: 0, plus_m: chainage_m, chainage_m, discontinuity };
}

function sec(id: string, itemKey: string, chainage_m: number, area_m2: number): StationSection {
  return { id, station: station(`No.${chainage_m}`, chainage_m), itemKey, area_m2 };
}

/** 측정 원장 한 건 (basis 셀 참조 해석용 resolver 입력) */
function meas(id: string, value: number, kind: Measurement['kind'] = 'length'): Measurement {
  return {
    id,
    drawingId: 'd1',
    kind,
    value,
    rawValue: value,
    method: 'manual',
    sourceHandles: [],
    label: id,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildBasis — 측정 소스', () => {
  it('단순 측정값은 측정 셀 참조(fRef)로 조립되고 원장값으로 평가된다', () => {
    const source: MeasurementSource = {
      kind: 'measurement',
      measurementId: 'm1',
      value: 12.5,
      label: '절토부',
    };
    const basis = buildBasis(source, undefined, []);
    expect(basis).not.toBeNull();
    if (basis === null) return;
    // P4-12: 하드코딩 숫자가 아니라 측정 셀 참조여야 한다.
    expect(basis).toEqual({ op: 'ref', cell: 'measurement:m1:value', label: '절토부' });
    expect(evaluatePlain(basis, { sections: [], measurements: [meas('m1', 12.5)] })).toBe(12.5);
  });

  it('area-thickness 규격이면 면적×두께', () => {
    const spec: MaterialSpec = {
      code: 'SC-1',
      workType: '포장공',
      name: '쇄석포설',
      spec: 't=0.2',
      unit: '㎥',
      calcType: 'area-thickness',
    };
    const source: MeasurementSource = {
      kind: 'measurement',
      measurementId: 'm1',
      value: 100,
      label: '포장면',
      thickness_m: 0.2,
    };
    const basis = buildBasis(source, spec, []);
    expect(basis).not.toBeNull();
    if (basis === null) return;
    // 100 × 0.2 = 20 (면적은 측정 셀 참조, 두께는 규격 상수)
    expect(
      evaluatePlain(basis, { sections: [], measurements: [meas('m1', 100, 'area')] }),
    ).toBeCloseTo(20, 10);
  });
});

describe('buildBasis — 구간 체적 소스', () => {
  it('정상 구간은 구간 체적 셀 참조로 조립되고 양단면평균법 합과 일치', () => {
    const sections = [sec('a', '절토', 0, 10), sec('b', '절토', 20, 14)];
    const source: SegmentVolumeSource = { kind: 'segment-volume', itemKey: '절토' };
    const basis = buildBasis(source, undefined, sections);
    expect(basis).not.toBeNull();
    if (basis === null) return;
    // P4-12: 단일 구간이면 fRef(segment:a~b:volume) — 하드코딩 체적이 아니다.
    expect(basis).toMatchObject({ op: 'ref', cell: 'segment:a~b:volume' });
    // (10+14)/2 × 20 = 240
    expect(evaluatePlain(basis, { sections, measurements: [] })).toBeCloseTo(240, 10);
  });

  it('전 결측(blocked) 구간은 basis=null (산출 차단)', () => {
    // 전/후 불연속에서 (전) 단면 결측 → core 가 blocked, buildBasis 는 null.
    const pre: StationSection = {
      id: 'pre',
      station: station('No.8(전)', 160, 'pre'),
      itemKey: '절토',
      area_m2: Number.NaN, // 결측 (station-derive 규칙: 비유한 → undefined)
    };
    const post: StationSection = {
      id: 'post',
      station: station('No.8(후)', 160, 'post'),
      itemKey: '절토',
      area_m2: 12,
    };
    const before = sec('before', '절토', 140, 10);
    const source: SegmentVolumeSource = { kind: 'segment-volume', itemKey: '절토' };
    const basis = buildBasis(source, undefined, [before, pre, post]);
    expect(basis).toBeNull();
  });
});

describe('buildBasis — 규격 환산·할증 체이닝', () => {
  it('환산계수 × 할증률이 순서대로 적용된다', () => {
    // 철근: m → TON 환산(단위중량) + 할증 3%.
    const spec: MaterialSpec = {
      code: 'REBAR-D16',
      workType: '철근콘크리트공',
      name: '철근',
      spec: 'SD400 D16',
      unit: 'TON',
      calcType: 'length',
      conversions: [{ toUnit: 'TON', factor: 0.00158, note: '단위중량 kg/m → TON' }],
      lossRate: 0.03,
    };
    const source: MeasurementSource = {
      kind: 'measurement',
      measurementId: 'm1',
      value: 1000, // 1000 m
      label: '주철근',
    };
    const basis = buildBasis(source, spec, []);
    expect(basis).not.toBeNull();
    if (basis === null) return;
    // 1000 × 0.00158 × 1.03 (연장은 측정 셀 참조)
    expect(evaluatePlain(basis, { sections: [], measurements: [meas('m1', 1000)] })).toBeCloseTo(
      1000 * 0.00158 * 1.03,
      10,
    );
  });

  it('환산·할증 없으면 원값 그대로', () => {
    const spec: MaterialSpec = {
      code: 'PLAIN',
      workType: '토공사',
      name: '터파기',
      spec: '',
      unit: '㎥',
      calcType: 'section-length',
    };
    const source: MeasurementSource = {
      kind: 'measurement',
      measurementId: 'm1',
      value: 42,
      label: 'x',
    };
    const basis = buildBasis(source, spec, []);
    expect(basis).not.toBeNull();
    if (basis === null) return;
    expect(evaluatePlain(basis, { sections: [], measurements: [meas('m1', 42)] })).toBe(42);
  });
});
