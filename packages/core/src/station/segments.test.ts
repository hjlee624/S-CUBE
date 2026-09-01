import type { Station } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../quantity/formula.ts';
import {
  buildSegments,
  prismoidalVolume,
  type SectionInput,
  segmentVolume,
  totalVolume,
} from './segments.ts';

function station(
  chainage_m: number,
  discontinuity: 'pre' | 'post' | null = null,
  no = 0,
  plus_m = chainage_m,
): Station {
  return { raw: `No.${no}+${plus_m}`, no, plus_m, chainage_m, discontinuity };
}

function input(
  id: string,
  chainage_m: number,
  area_m2: number | undefined,
  discontinuity: 'pre' | 'post' | null = null,
  itemKey = '절토',
): SectionInput {
  return { id, station: station(chainage_m, discontinuity), itemKey, area_m2 };
}

describe('buildSegments — 정상 구간 (양단면평균법)', () => {
  it('V = (A1+A2)/2 × L 해석해 일치', () => {
    const sections = [input('a', 0, 10), input('b', 20, 20), input('c', 40, 30)];
    const { segments, errors } = buildSegments(sections, '절토', 'average-end-area');
    expect(errors).toEqual([]);
    expect(segments).toHaveLength(2);
    // (10+20)/2 × 20 = 300
    expect(segments[0]?.volume_m3).toBe(300);
    expect(segments[0]?.length_m).toBe(20);
    // (20+30)/2 × 20 = 500
    expect(segments[1]?.volume_m3).toBe(500);
  });

  it('itemKey 로 필터 — 다른 항목 단면은 무시', () => {
    const sections = [
      input('a', 0, 10, null, '절토'),
      input('x', 0, 99, null, '성토'),
      input('b', 20, 20, null, '절토'),
    ];
    const { segments } = buildSegments(sections, '절토', 'average-end-area');
    expect(segments).toHaveLength(1);
    expect(segments[0]?.a1).toBe(10);
    expect(segments[0]?.a2).toBe(20);
  });

  it('a1/a2 는 각 단면 area_m2 로 설정', () => {
    const { segments } = buildSegments(
      [input('a', 0, 12.5), input('b', 20, 14.2)],
      '절토',
      'average-end-area',
    );
    expect(segments[0]?.a1).toBe(12.5);
    expect(segments[0]?.a2).toBe(14.2);
    expect(segments[0]?.volume_m3).toBeCloseTo(((12.5 + 14.2) / 2) * 20, 12);
  });

  it('내부 반올림 없음 — full precision', () => {
    const { segments } = buildSegments(
      [input('a', 0, 1.111), input('b', 3.3, 2.222)],
      '절토',
      'average-end-area',
    );
    expect(segments[0]?.volume_m3).toBeCloseTo(((1.111 + 2.222) / 2) * 3.3, 12);
  });
});

describe('buildSegments — 전/후 불연속 (§4 핵심)', () => {
  it('pre/post 쌍: 앞구간=pre종점·뒤구간=post시점·중간연장0·체적중복 없음', () => {
    // No.7+0 (A=10) → No.8+0(전) (A=20) | No.8+0(후) (A=40) → No.9+0 (A=50)
    const sections = [
      input('s7', 140, 10, null),
      input('pre', 160, 20, 'pre'),
      input('post', 160, 40, 'post'),
      input('s9', 180, 50, null),
    ];
    const { segments, errors } = buildSegments(sections, '절토', 'average-end-area');
    expect(errors).toEqual([]);
    // 세 구간: [s7→pre], [pre→post length0], [post→s9]
    expect(segments).toHaveLength(3);

    const [seg1, segGap, seg3] = segments;
    // 앞 구간 종점 = pre 단면 (A2 = 20)
    expect(seg1?.to.discontinuity).toBe('pre');
    expect(seg1?.a2).toBe(20);
    expect(seg1?.length_m).toBe(20);
    expect(seg1?.volume_m3).toBe(((10 + 20) / 2) * 20); // 300

    // pre↔post 사이 연장 0, 체적 0 (중복 계상 금지)
    expect(segGap?.length_m).toBe(0);
    expect(segGap?.volume_m3).toBe(0);

    // 뒤 구간 시점 = post 단면 (A1 = 40)
    expect(seg3?.from.discontinuity).toBe('post');
    expect(seg3?.a1).toBe(40);
    expect(seg3?.length_m).toBe(20);
    expect(seg3?.volume_m3).toBe(((40 + 50) / 2) * 20); // 900

    // 총 체적 = 300 + 0 + 900 = 1200 (불연속 구간 중복 없음)
    const total = segments.reduce((acc, s) => acc + s.volume_m3, 0);
    expect(total).toBe(1200);
  });

  it('pre 단면 area 결측 → SegmentError 승격, 산출 차단 (곡성 No.8+0.000(전) 재발 방지)', () => {
    const sections = [
      input('s7', 140, 10, null),
      input('pre', 160, undefined, 'pre'), // (전) 단면 값 비어 있음
      input('post', 160, 40, 'post'),
      input('s9', 180, 50, null),
    ];
    const { segments, errors } = buildSegments(sections, '절토', 'average-end-area');

    // 에러로 승격 — 조용히 0 처리 금지
    const preError = errors.find((e) => e.reason === 'pre-section-missing-area');
    expect(preError).toBeDefined();
    expect(preError?.chainage_m).toBe(160);
    expect(preError?.sectionIds).toContain('pre');

    // pre↔post 불연속 구간(체적0)은 산출하지 않는다 — Segment 미생성
    const gap = segments.find((s) => s.length_m === 0);
    expect(gap).toBeUndefined();

    // 조용히 0 으로 채운 구간이 없어야 한다 — s7→pre 구간도 pre area 결측이라 미생성
    // (앞 구간 종점이 결측이므로 산출 차단)
    const s7ToPre = segments.find((s) => s.to.discontinuity === 'pre');
    expect(s7ToPre).toBeUndefined();
  });
});

describe('buildSegments — 결측 구간(orphan) 표시', () => {
  it('단면 하나뿐이면 orphan 에러', () => {
    const { segments, errors } = buildSegments([input('a', 0, 10)], '절토', 'average-end-area');
    expect(segments).toEqual([]);
    expect(errors.some((e) => e.reason === 'orphan-section')).toBe(true);
  });

  it('flagOrphans:false 면 orphan 표시 안 함', () => {
    const { errors } = buildSegments([input('a', 0, 10)], '절토', 'average-end-area', {
      flagOrphans: false,
    });
    expect(errors).toEqual([]);
  });
});

describe('segmentVolume / prismoidalVolume — 각주법', () => {
  it('prismoidal V = L/6 × (A1 + 4·Am + A2) 해석해', () => {
    // A1=10, Am=15, A2=20, L=20 → 20/6 × (10 + 60 + 20) = 20/6 × 90 = 300
    const node = prismoidalVolume(10, 15, 20, 20);
    expect(evaluate(node)).toBeCloseTo((20 / 6) * (10 + 4 * 15 + 20), 12);
    expect(evaluate(node)).toBeCloseTo(300, 12);
  });

  it('Am 이 (A1+A2)/2 면 각주법 = 평균단면법', () => {
    const a1 = 10;
    const a2 = 20;
    const L = 20;
    const mid = (a1 + a2) / 2; // 15
    const prism = evaluate(prismoidalVolume(a1, mid, a2, L));
    const avg = evaluate(segmentVolume(a1, a2, L, 'average-end-area'));
    expect(prism).toBeCloseTo(avg, 12);
  });

  it('segmentVolume prismoidal + Am 제공 → 각주법 사용', () => {
    const node = segmentVolume(10, 20, 20, 'prismoidal', 15);
    expect(evaluate(node)).toBeCloseTo((20 / 6) * (10 + 60 + 20), 12);
  });

  it('segmentVolume prismoidal + Am 미제공 → 평균단면법으로 대체', () => {
    const node = segmentVolume(10, 20, 20, 'prismoidal');
    expect(evaluate(node)).toBe(((10 + 20) / 2) * 20);
  });
});

describe('totalVolume / blocked — 부분합 누출 방지 (§4)', () => {
  it('정상 항목: blocked=false, totalVolume=정상 구간 합', () => {
    const sections = [input('a', 0, 10), input('b', 20, 20), input('c', 40, 30)];
    const result = buildSegments(sections, '절토', 'average-end-area');
    expect(result.blocked).toBe(false);
    // 300 + 500 = 800
    expect(totalVolume(result)).toBe(800);
  });

  it('(전) 결측: blocked=true, totalVolume=null (정상 구간 부분합을 조용히 흘리지 않음)', () => {
    const sections = [
      input('s7', 140, 10, null),
      input('pre', 160, undefined, 'pre'),
      input('post', 160, 40, 'post'),
      input('s9', 180, 50, null),
    ];
    const result = buildSegments(sections, '절토', 'average-end-area');
    expect(result.blocked).toBe(true);
    expect(totalVolume(result)).toBeNull();
  });

  it('일반 결측이 중간에 끼어도 정상 구간 부분합을 반환하지 않는다', () => {
    // s0→s1 정상, s1 결측으로 s1→s2 차단 → 전체 blocked, totalVolume null.
    const sections = [input('s0', 0, 10), input('s1', 20, undefined), input('s2', 40, 30)];
    const result = buildSegments(sections, '절토', 'average-end-area');
    expect(result.blocked).toBe(true);
    expect(totalVolume(result)).toBeNull();
  });

  it('orphan(단면 1개) 은 차단이 아니다 — blocked=false, totalVolume=0', () => {
    const result = buildSegments([input('a', 0, 10)], '절토', 'average-end-area');
    expect(result.errors.some((e) => e.reason === 'orphan-section')).toBe(true);
    expect(result.blocked).toBe(false);
    expect(totalVolume(result)).toBe(0);
  });

  it('각주법 Am 미제공 안내는 차단이 아니다 — blocked=false', () => {
    const result = buildSegments([input('a', 0, 10), input('b', 20, 20)], '절토', 'prismoidal');
    expect(result.errors.some((e) => e.reason === 'prismoidal-missing-mid')).toBe(true);
    expect(result.blocked).toBe(false);
    expect(totalVolume(result)).toBe(((10 + 20) / 2) * 20);
  });
});

describe('buildSegments — 전/후 불연속 post 결측 처리', () => {
  it('post 단면 결측이면 a2 를 pre 값으로 조용히 대체하지 않는다 (a2=0)', () => {
    // 연장 0 이라 체적에는 영향 없지만, a2 표시가 실제(결측)와 달라지는 왜곡을 막는다.
    const sections = [
      input('s7', 140, 10, null),
      input('pre', 160, 20, 'pre'),
      input('post', 160, undefined, 'post'),
      input('s9', 180, 50, null),
    ];
    const { segments } = buildSegments(sections, '절토', 'average-end-area');
    const gap = segments.find((s) => s.length_m === 0);
    expect(gap).toBeDefined();
    expect(gap?.a1).toBe(20); // pre 종점
    expect(gap?.a2).toBe(0); // post 결측 — pre(20)으로 대체하지 않는다
    expect(gap?.volume_m3).toBe(0);
  });
});

describe('buildSegments — 각주법 Am 미제공 안내', () => {
  it('midArea_m2 없이 prismoidal 요청 → 평균단면법 대체 + 안내 에러', () => {
    const sections = [input('a', 0, 10), input('b', 20, 20)];
    const { segments, errors } = buildSegments(sections, '절토', 'prismoidal');
    expect(segments[0]?.method).toBe('average-end-area');
    expect(segments[0]?.volume_m3).toBe(((10 + 20) / 2) * 20);
    expect(errors.some((e) => e.reason === 'prismoidal-missing-mid')).toBe(true);
  });

  it('midArea_m2 제공 시 각주법 사용', () => {
    const sections: SectionInput[] = [
      { id: 'a', station: station(0), itemKey: '절토', area_m2: 10 },
      { id: 'b', station: station(20), itemKey: '절토', area_m2: 20, midArea_m2: 15 },
    ];
    const { segments, errors } = buildSegments(sections, '절토', 'prismoidal');
    expect(segments[0]?.method).toBe('prismoidal');
    expect(segments[0]?.volume_m3).toBeCloseTo((20 / 6) * (10 + 60 + 20), 12);
    expect(errors).toEqual([]);
  });
});
