/**
 * 측점 파생 순수 로직 테스트 (Phase 3-C).
 *
 * 커버:
 *  - 파싱 성공/실패 (조용히 넘기지 않고 에러로 표시)
 *  - 인접 측점 쌍 → 양단면평균법 체적 파생
 *  - 전/후 불연속: 연장 0·체적 0·(전) 결측 시 에러 승격·산출 차단 (03-DATA-MODEL §4)
 *  - 이상 감지: 면적0/음수·3배 급변·연장 이상
 */
import { buildSegments as coreBuildSegments, totalVolume as coreTotalVolume } from '@s-cube/core';
import type { Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  detectAnomalies,
  isStationParseError,
  parseStation,
  sortSections,
  totalVolume,
} from './station-derive.ts';

/** 파싱된 Station 을 뽑는 헬퍼 — 실패면 throw (테스트 편의) */
function st(raw: string, interval = 20): Station {
  const r = parseStation(raw, interval);
  if (isStationParseError(r)) throw new Error(`파싱 실패: ${raw} — ${r.reason}`);
  const { ok: _ok, ...station } = r;
  return station;
}

function sec(
  id: string,
  raw: string,
  itemKey: string,
  area_m2: number,
  interval = 20,
): StationSection {
  return { id, station: st(raw, interval), itemKey, area_m2 };
}

describe('parseStation — 표기 파싱 (P3-1·P3-2)', () => {
  it('기본 표기 No.8+0.000 → chainage = 8×20 + 0', () => {
    const r = parseStation('No.8+0.000', 20);
    expect(isStationParseError(r)).toBe(false);
    if (!isStationParseError(r)) {
      expect(r.no).toBe(8);
      expect(r.plus_m).toBe(0);
      expect(r.chainage_m).toBe(160);
      expect(r.discontinuity).toBeNull();
    }
  });

  it('전/후 표기 (전)/(후)/(前)/(後) 를 discontinuity 로 인식', () => {
    const pre = parseStation('No.8+0.000(전)', 20);
    const post = parseStation('No.8+0.000(後)', 20);
    if (!isStationParseError(pre)) expect(pre.discontinuity).toBe('pre');
    if (!isStationParseError(post)) expect(post.discontinuity).toBe('post');
  });

  it('STA.0+120.5 변형 수용', () => {
    const r = parseStation('STA.0+120.5', 20);
    if (!isStationParseError(r)) {
      expect(r.chainage_m).toBeCloseTo(120.5, 6);
    } else {
      throw new Error('STA. 표기 파싱 실패');
    }
  });

  it('파싱 실패는 조용히 넘기지 않고 에러(사유 포함)로 반환한다', () => {
    const r = parseStation('완전잘못된값', 20);
    expect(isStationParseError(r)).toBe(true);
    if (isStationParseError(r)) {
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.raw).toBe('완전잘못된값');
    }
  });

  it('빈 문자열도 에러', () => {
    expect(isStationParseError(parseStation('   ', 20))).toBe(true);
  });
});

describe('buildSegments — 인접 측점 체적 파생 (P3-6·P3-9)', () => {
  it('인접 두 단면으로 양단면평균법 체적 = (A1+A2)/2 × L', () => {
    // No.0+0(chainage 0) A=10, No.1+0(chainage 20) A=30 → (10+30)/2 × 20 = 400
    const sections = [sec('a', 'No.0+0.000', '절토', 10), sec('b', 'No.1+0.000', '절토', 30)];
    const { segments, errors } = buildSegments(sections, '절토');
    expect(errors).toHaveLength(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.length_m).toBe(20);
    expect(segments[0]?.volume_m3).toBeCloseTo(400, 9);
  });

  it('연속 3측점 → 2구간, 합계 체적 파생', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 10),
      sec('b', 'No.1+0.000', '절토', 20),
      sec('c', 'No.2+0.000', '절토', 40),
    ];
    const result = buildSegments(sections, '절토');
    expect(result.segments).toHaveLength(2);
    // (10+20)/2×20 = 300, (20+40)/2×20 = 600 → 합 900
    expect(totalVolume(result)).toBeCloseTo(900, 9);
  });

  it('다른 itemKey 단면은 섞이지 않는다', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 10),
      sec('b', 'No.1+0.000', '절토', 30),
      sec('c', 'No.0+0.000', '성토', 5),
      sec('d', 'No.1+0.000', '성토', 5),
    ];
    expect(buildSegments(sections, '절토').segments).toHaveLength(1);
    expect(buildSegments(sections, '성토').segments[0]?.volume_m3).toBeCloseTo(100, 9);
  });

  it('내부 계산은 반올림하지 않는다', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 1.2345),
      sec('b', 'No.0+10.000', '절토', 2.7655),
    ];
    const { segments } = buildSegments(sections, '절토');
    // (1.2345+2.7655)/2 × 10 = 20 정확
    expect(segments[0]?.volume_m3).toBeCloseTo(20, 9);
  });
});

describe('buildSegments — 전/후 불연속 (03-DATA-MODEL §4)', () => {
  it('전/후 경계는 연장 0·체적 0 으로 중복 계상하지 않는다', () => {
    // No.8+0(전) A=15, No.8+0(후) A=25 (같은 chainage). 앞 구간은 pre 를 종점, 뒤는 post 를 시점.
    const sections = [
      sec('p0', 'No.7+0.000', '절토', 10),
      sec('pre', 'No.8+0.000(전)', '절토', 15),
      sec('post', 'No.8+0.000(후)', '절토', 25),
      sec('p1', 'No.9+0.000', '절토', 20),
    ];
    const { segments, errors } = buildSegments(sections, '절토');
    expect(errors).toHaveLength(0);
    // 구간: (7→8전), (8전→8후 = 연장0), (8후→9)
    expect(segments).toHaveLength(3);
    const disc = segments.find(
      (s) => s.from.discontinuity === 'pre' && s.to.discontinuity === 'post',
    );
    expect(disc?.length_m).toBe(0);
    expect(disc?.volume_m3).toBe(0);
  });

  it('(전) 단면 값이 비면 에러로 승격하고 산출을 차단한다 (곡성 재발 방지)', () => {
    // (전) 단면적을 NaN 으로 결측 처리 — 정상 파싱된 station 을 쓰되 area 를 무효값으로.
    const preStation = st('No.8+0.000(전)');
    const sections: StationSection[] = [
      sec('p0', 'No.7+0.000', '절토', 10),
      { id: 'pre', station: preStation, itemKey: '절토', area_m2: Number.NaN },
      sec('post', 'No.8+0.000(후)', '절토', 25),
      sec('p1', 'No.9+0.000', '절토', 20),
    ];
    const result = buildSegments(sections, '절토');
    const preMissing = result.errors.find((e) => e.kind === 'pre-missing');
    expect(preMissing).toBeDefined();
    expect(preMissing?.reason).toContain('산출을 차단');
    // 계산 계층이 blocked 로 못박는다 — 부분합이 조용히 새지 않는다(곡성 재발 방지).
    expect(result.blocked).toBe(true);
    expect(totalVolume(result)).toBeNull();
  });

  it('일반 결측(음수 단면적)도 해당 구간 산출을 차단한다', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 10),
      { id: 'b', station: st('No.1+0.000'), itemKey: '절토', area_m2: -5 },
    ];
    const result = buildSegments(sections, '절토');
    expect(result.segments).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === 'area-invalid')).toBe(true);
    // 결측이 있으면 blocked — totalVolume 은 부분합(0) 이 아니라 null 을 준다.
    expect(result.blocked).toBe(true);
    expect(totalVolume(result)).toBeNull();
  });

  it('정상 구간 사이에 결측이 끼면 정상 구간 부분합을 조용히 흘리지 않는다', () => {
    // s0→s1 은 정상(체적 발생 가능)이지만 s1(area 결측) 때문에 s0→s1·s1→s2 모두 차단.
    const sections: StationSection[] = [
      sec('s0', 'No.0+0.000', '절토', 10),
      { id: 's1', station: st('No.1+0.000'), itemKey: '절토', area_m2: Number.NaN },
      sec('s2', 'No.2+0.000', '절토', 30),
    ];
    const result = buildSegments(sections, '절토');
    // 조용한 부분합 누출 방지: blocked 이면 totalVolume 은 null.
    expect(result.blocked).toBe(true);
    expect(totalVolume(result)).toBeNull();
  });
});

describe('sortSections — 정렬 규칙', () => {
  it('chainage 오름차순, 동일 chainage 는 pre → null → post', () => {
    const sections = [
      sec('post', 'No.8+0.000(후)', '절토', 25),
      sec('later', 'No.9+0.000', '절토', 20),
      sec('pre', 'No.8+0.000(전)', '절토', 15),
      sec('earlier', 'No.7+0.000', '절토', 10),
    ];
    const sorted = sortSections(sections);
    expect(sorted.map((s) => s.id)).toEqual(['earlier', 'pre', 'post', 'later']);
  });
});

describe('detectAnomalies — 이상 감지 (P3-15)', () => {
  it('면적 0 또는 음수를 이상으로 표시', () => {
    const sections = [sec('a', 'No.0+0.000', '절토', 0), sec('b', 'No.1+0.000', '절토', 10)];
    const anomalies = detectAnomalies(sections, '절토', 20);
    expect(anomalies.some((a) => a.kind === 'area-zero-or-negative' && a.sectionId === 'a')).toBe(
      true,
    );
  });

  it('인접 단면적 3배 이상 급변을 이상으로 표시', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 10),
      sec('b', 'No.1+0.000', '절토', 40), // 4배
    ];
    const anomalies = detectAnomalies(sections, '절토', 20);
    expect(anomalies.some((a) => a.kind === 'area-jump')).toBe(true);
  });

  it('연장이 표준 간격과 크게 다르면 이상으로 표시(불연속 연장0 은 제외)', () => {
    const sections = [
      sec('a', 'No.0+0.000', '절토', 10),
      sec('b', 'No.0+100.000', '절토', 10), // 연장 100 vs 간격 20 → 5배
    ];
    const anomalies = detectAnomalies(sections, '절토', 20);
    expect(anomalies.some((a) => a.kind === 'length-outlier')).toBe(true);
  });

  it('전/후 불연속 연장0 은 연장 이상으로 잡지 않는다', () => {
    const sections = [
      sec('pre', 'No.8+0.000(전)', '절토', 15),
      sec('post', 'No.8+0.000(후)', '절토', 15),
    ];
    const anomalies = detectAnomalies(sections, '절토', 20);
    expect(anomalies.some((a) => a.kind === 'length-outlier')).toBe(false);
  });
});

describe('단일 진실원천 교차검증 — 앱 어댑터가 @s-cube/core 실행 경로를 탄다', () => {
  it('정상 전/후 불연속: 어댑터 segments 가 core buildSegments 와 동일', () => {
    const sections = [
      sec('p0', 'No.7+0.000', '절토', 10),
      sec('pre', 'No.8+0.000(전)', '절토', 15),
      sec('post', 'No.8+0.000(후)', '절토', 25),
      sec('p1', 'No.9+0.000', '절토', 20),
    ];
    const inputs = sections.map((s) => ({
      id: s.id,
      station: s.station,
      itemKey: s.itemKey,
      area_m2: s.area_m2,
    }));
    const web = buildSegments(sections, '절토');
    const core = coreBuildSegments(inputs, '절토', 'average-end-area', { flagOrphans: false });
    expect(web.segments).toEqual(core.segments);
    expect(web.blocked).toBe(core.blocked);
    // 총 체적도 core.totalVolume 과 동일 — 부분합이 아니라 계약된 합계.
    expect(totalVolume(web)).toBe(coreTotalVolume(core));
  });

  it('곡성 (전) 결측: 어댑터도 core 도 blocked, totalVolume null (한쪽만 고쳐지는 조용한 회귀 차단)', () => {
    const sections: StationSection[] = [
      sec('p0', 'No.7+0.000', '절토', 10),
      { id: 'pre', station: st('No.8+0.000(전)'), itemKey: '절토', area_m2: Number.NaN },
      sec('post', 'No.8+0.000(후)', '절토', 25),
      sec('p1', 'No.9+0.000', '절토', 20),
    ];
    const inputs = sections.map((s) => ({
      id: s.id,
      station: s.station,
      itemKey: s.itemKey,
      // 앱 어댑터와 동일하게 비유한 면적은 결측(undefined)으로 사상.
      area_m2: Number.isFinite(s.area_m2) && s.area_m2 >= 0 ? s.area_m2 : undefined,
    }));
    const web = buildSegments(sections, '절토');
    const core = coreBuildSegments(inputs, '절토', 'average-end-area', { flagOrphans: false });
    expect(web.blocked).toBe(true);
    expect(core.blocked).toBe(true);
    expect(totalVolume(web)).toBeNull();
    expect(coreTotalVolume(core)).toBeNull();
  });
});
