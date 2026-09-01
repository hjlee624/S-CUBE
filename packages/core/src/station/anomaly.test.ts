import type { Segment, Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { detectAnomalies } from './anomaly.ts';

function station(chainage_m: number, discontinuity: 'pre' | 'post' | null = null): Station {
  return { raw: `No.0+${chainage_m}`, no: 0, plus_m: chainage_m, chainage_m, discontinuity };
}

function section(
  id: string,
  chainage_m: number,
  area_m2: number,
  itemKey = '절토',
): StationSection {
  return { id, station: station(chainage_m), itemKey, area_m2 };
}

function segment(
  fromChainage: number,
  toChainage: number,
  length_m: number,
  itemKey = '절토',
): Segment {
  return {
    fromId: `s-${fromChainage}`,
    toId: `s-${toChainage}`,
    from: station(fromChainage),
    to: station(toChainage),
    length_m,
    itemKey,
    a1: 10,
    a2: 10,
    volume_m3: 10 * length_m,
    method: 'average-end-area',
  };
}

describe('detectAnomalies — 단면적 0/음수', () => {
  it('단면적 0 → area-nonpositive', () => {
    const anomalies = detectAnomalies([section('a', 0, 0)], []);
    expect(anomalies.some((x) => x.kind === 'area-nonpositive')).toBe(true);
  });

  it('단면적 음수 → area-nonpositive', () => {
    const anomalies = detectAnomalies([section('a', 0, -5)], []);
    const hit = anomalies.find((x) => x.kind === 'area-nonpositive');
    expect(hit).toBeDefined();
    expect(hit?.sectionIds).toContain('a');
  });

  it('양수 단면적만 있으면 area-nonpositive 없음', () => {
    const anomalies = detectAnomalies([section('a', 0, 10), section('b', 20, 12)], []);
    expect(anomalies.some((x) => x.kind === 'area-nonpositive')).toBe(false);
  });
});

describe('detectAnomalies — 인접 단면적 3배 이상 급변', () => {
  it('10 → 40 (4배) → area-jump', () => {
    const anomalies = detectAnomalies([section('a', 0, 10), section('b', 20, 40)], []);
    const jump = anomalies.find((x) => x.kind === 'area-jump');
    expect(jump).toBeDefined();
    expect(jump?.chainages_m).toEqual([0, 20]);
    expect(jump?.sectionIds).toEqual(['a', 'b']);
  });

  it('10 → 25 (2.5배) → 급변 아님', () => {
    const anomalies = detectAnomalies([section('a', 0, 10), section('b', 20, 25)], []);
    expect(anomalies.some((x) => x.kind === 'area-jump')).toBe(false);
  });

  it('정확히 3배 → 급변 (경계 포함)', () => {
    const anomalies = detectAnomalies([section('a', 0, 10), section('b', 20, 30)], []);
    expect(anomalies.some((x) => x.kind === 'area-jump')).toBe(true);
  });

  it('감소 급변도 검출 (40 → 10)', () => {
    const anomalies = detectAnomalies([section('a', 0, 40), section('b', 20, 10)], []);
    expect(anomalies.some((x) => x.kind === 'area-jump')).toBe(true);
  });

  it('itemKey 가 다르면 인접 비교 안 함', () => {
    const anomalies = detectAnomalies(
      [section('a', 0, 10, '절토'), section('b', 20, 40, '성토')],
      [],
    );
    expect(anomalies.some((x) => x.kind === 'area-jump')).toBe(false);
  });

  it('jumpFactor 옵션 변경', () => {
    const anomalies = detectAnomalies([section('a', 0, 10), section('b', 20, 25)], [], {
      jumpFactor: 2,
    });
    expect(anomalies.some((x) => x.kind === 'area-jump')).toBe(true);
  });
});

describe('detectAnomalies — 연장이 표준 측점 간격과 크게 다름', () => {
  it('간격 20m, 연장 5m (허용 ±50% = 10~30) → length-off-interval', () => {
    const anomalies = detectAnomalies([], [segment(0, 5, 5)], { stationInterval_m: 20 });
    expect(anomalies.some((x) => x.kind === 'length-off-interval')).toBe(true);
  });

  it('간격 20m, 연장 20m → 정상', () => {
    const anomalies = detectAnomalies([], [segment(0, 20, 20)], { stationInterval_m: 20 });
    expect(anomalies.some((x) => x.kind === 'length-off-interval')).toBe(false);
  });

  it('연장 0 (전/후 불연속) 은 정상 처리 — 검사 제외', () => {
    const anomalies = detectAnomalies([], [segment(160, 160, 0)], { stationInterval_m: 20 });
    expect(anomalies.some((x) => x.kind === 'length-off-interval')).toBe(false);
  });

  it('stationInterval_m 미지정이면 연장 검사 건너뜀', () => {
    const anomalies = detectAnomalies([], [segment(0, 5, 5)]);
    expect(anomalies.some((x) => x.kind === 'length-off-interval')).toBe(false);
  });

  it('연장이 표준의 2배(40m)로 크게 초과 → 검출', () => {
    const anomalies = detectAnomalies([], [segment(0, 40, 40)], { stationInterval_m: 20 });
    expect(anomalies.some((x) => x.kind === 'length-off-interval')).toBe(true);
  });
});
