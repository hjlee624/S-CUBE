/**
 * 단면적 취득 순수 로직 테스트 (P3-13) — jsdom 불필요(순수 함수).
 *
 * 커버:
 *  - 축척² 적용된 cut/fill 환산 (정확성 핵심)
 *  - cut→'절토'·fill→'성토' 라우팅
 *  - 단면 생성(create) / 기존 단면 갱신(assign)
 *  - 활성 측점 없을 때(resolveActiveStation null) 처리
 *  - 프로파일 정점 추출(line 2점화·polyline 그대로·비대상 null)
 *  - 0인 쪽 셀·측정 미생성
 */
import type { PVertex, Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  CUT_ITEM_KEY,
  computeSectionAreas,
  extractProfileVertices,
  FILL_ITEM_KEY,
  formatSectionToast,
  planSectionAssignments,
  resolveActiveStation,
} from './section-area.ts';

function pv(x: number, y: number, bulge = 0): PVertex {
  return { p: { x, y }, bulge };
}

function station(raw: string, chainage_m: number): Station {
  return { raw, no: 8, plus_m: 0, chainage_m, discontinuity: null };
}

// 원지반선: 평평한 지반 y=10, x 0..10. 계획선: 절반은 아래(절토), 절반은 위(성토)로 갈리는 대신
// 아래 테스트는 케이스별로 명시적으로 구성한다.

describe('extractProfileVertices — 프로파일 정점 추출', () => {
  it('line 은 2점 폴리라인(bulge 0)으로 변환', () => {
    const v = extractProfileVertices({
      kind: 'line',
      handle: 'L1',
      layer: '0',
      a: { x: 0, y: 0 },
      b: { x: 5, y: 3 },
    });
    expect(v).toEqual([pv(0, 0), pv(5, 3)]);
  });

  it('polyline 은 vertices 그대로(bulge 포함)', () => {
    const verts = [pv(0, 0), pv(5, 2, 0.5), pv(10, 0)];
    const v = extractProfileVertices({
      kind: 'polyline',
      handle: 'P1',
      layer: '0',
      vertices: verts,
      closed: false,
    });
    expect(v).toBe(verts);
  });

  it('정점 1개 폴리라인·비대상 엔티티(circle 등)는 null', () => {
    expect(
      extractProfileVertices({
        kind: 'polyline',
        handle: 'P2',
        layer: '0',
        vertices: [pv(0, 0)],
        closed: false,
      }),
    ).toBeNull();
    expect(
      extractProfileVertices({
        kind: 'circle',
        handle: 'C1',
        layer: '0',
        center: { x: 0, y: 0 },
        r: 5,
      }),
    ).toBeNull();
  });
});

describe('computeSectionAreas — 축척² 적용 (정확성 핵심)', () => {
  // 원지반선이 계획선보다 위(전 구간): 순수 절토. 폭 10 × 높이 5 = 도면단위² 50.
  const ground = [pv(0, 10), pv(10, 10)];
  const design = [pv(0, 5), pv(10, 5)];

  it('scale=1 이면 도면단위² 그대로 (cut=50, fill=0)', () => {
    const r = computeSectionAreas(ground, design, 1);
    expect(r.cutRaw).toBeCloseTo(50, 9);
    expect(r.fillRaw).toBeCloseTo(0, 9);
    expect(r.cut_m2).toBeCloseTo(50, 9);
    expect(r.fill_m2).toBeCloseTo(0, 9);
  });

  it('면적은 축척의 제곱을 곱한다 — scale 0.001 → cut 50 × 0.001² = 0.00005 ㎡', () => {
    const r = computeSectionAreas(ground, design, 0.001);
    // rawValue(도면단위²)는 축척 미적용으로 보존
    expect(r.cutRaw).toBeCloseTo(50, 9);
    // value(㎡)는 scale² 적용
    expect(r.cut_m2).toBeCloseTo(50 * 0.001 * 0.001, 15);
  });

  it('net_m2 = cut_m2 − fill_m2', () => {
    const r = computeSectionAreas(ground, design, 2);
    expect(r.net_m2).toBeCloseTo(r.cut_m2 - r.fill_m2, 12);
    // scale 2 → 50 × 4 = 200 ㎡ 절토
    expect(r.cut_m2).toBeCloseTo(200, 9);
  });

  it('성토: 계획선이 원지반보다 위면 fill 로 잡힌다', () => {
    const r = computeSectionAreas([pv(0, 0), pv(10, 0)], [pv(0, 4), pv(10, 4)], 1);
    expect(r.fillRaw).toBeCloseTo(40, 9);
    expect(r.cutRaw).toBeCloseTo(0, 9);
  });

  it('절토·성토 공존(교차) — 왼쪽 절토·오른쪽 성토', () => {
    // ground 수평 y=0. design 은 x=0 에서 -5(아래=절토), x=10 에서 +5(위=성토), x=5 에서 교차.
    const r = computeSectionAreas([pv(0, 0), pv(10, 0)], [pv(0, -5), pv(10, 5)], 1);
    // 좌측 삼각형(밑변5,높이5)=12.5 절토, 우측 동일=12.5 성토
    expect(r.cutRaw).toBeCloseTo(12.5, 6);
    expect(r.fillRaw).toBeCloseTo(12.5, 6);
  });
});

describe('resolveActiveStation — 활성 측점 역추적', () => {
  const sections: StationSection[] = [
    { id: 'sec-a', station: station('No.8+0.000', 160), itemKey: CUT_ITEM_KEY, area_m2: 12 },
  ];

  it('앵커 id 의 단면 station 을 돌려준다', () => {
    expect(resolveActiveStation(sections, 'sec-a')?.raw).toBe('No.8+0.000');
  });

  it('활성 측점 없음(null)·존재하지 않는 id → null (자동 기입 차단 신호)', () => {
    expect(resolveActiveStation(sections, null)).toBeNull();
    expect(resolveActiveStation(sections, 'nope')).toBeNull();
  });
});

describe('planSectionAssignments — cut→절토·fill→성토 라우팅 + create/assign', () => {
  const st = station('No.8+0.000', 160);
  const baseInput = {
    station: st,
    drawingId: 'dwg-1',
    groundHandle: 'G1',
    designHandle: 'D1',
    scale_mPerUnit: 1,
    stationLabel: 'No.8+0.000',
    createdAt: '2026-01-01T00:00:00.000Z',
    cutMeasurementId: 'm-cut',
    fillMeasurementId: 'm-fill',
    cutSectionId: 's-cut',
    fillSectionId: 's-fill',
  };

  it('절토·성토 공존 → 두 측정 생성 + 각 itemKey 로 라우팅(create)', () => {
    const result = computeSectionAreas([pv(0, 0), pv(10, 0)], [pv(0, -5), pv(10, 5)], 1);
    const plan = planSectionAssignments({ ...baseInput, result, sections: [] });

    expect(plan.measurements).toHaveLength(2);
    // 두 측정 모두 profile-cut-fill·area·sourceHandles=[ground,design] (FR-3.10 step 4)
    for (const m of plan.measurements) {
      expect(m.method).toBe('profile-cut-fill');
      expect(m.kind).toBe('area');
      expect(m.sourceHandles).toEqual(['G1', 'D1']);
    }
    const cutM = plan.measurements.find((m) => m.id === 'm-cut');
    const fillM = plan.measurements.find((m) => m.id === 'm-fill');
    expect(cutM?.label).toContain(CUT_ITEM_KEY);
    expect(fillM?.label).toContain(FILL_ITEM_KEY);
    // cutFill 필드로 절토/성토 부호 구분
    expect(cutM?.cutFill).toBe('cut');
    expect(fillM?.cutFill).toBe('fill');

    // writes: 둘 다 create, itemKey 라우팅 정확
    const cutW = plan.writes.find((w) => w.itemKey === CUT_ITEM_KEY);
    const fillW = plan.writes.find((w) => w.itemKey === FILL_ITEM_KEY);
    expect(cutW?.op).toBe('create');
    expect(fillW?.op).toBe('create');
    if (cutW?.op === 'create') {
      expect(cutW.section.itemKey).toBe(CUT_ITEM_KEY);
      expect(cutW.section.measurementId).toBe('m-cut');
      expect(cutW.section.area_m2).toBeCloseTo(12.5, 6);
    }
  });

  it('기존 (측점,절토) 단면이 있으면 assign(갱신)한다 — 생성하지 않음', () => {
    const result = computeSectionAreas([pv(0, 10), pv(10, 10)], [pv(0, 5), pv(10, 5)], 1); // 순수 절토 50
    const existing: StationSection[] = [
      { id: 'old-cut', station: st, itemKey: CUT_ITEM_KEY, area_m2: 1 },
    ];
    const plan = planSectionAssignments({ ...baseInput, result, sections: existing });

    // fill=0 → 성토 측정·write 없음. 절토만.
    expect(plan.measurements).toHaveLength(1);
    expect(plan.writes).toHaveLength(1);
    const w = plan.writes[0];
    expect(w?.op).toBe('assign');
    if (w?.op === 'assign') {
      expect(w.sectionId).toBe('old-cut');
      expect(w.measurementId).toBe('m-cut');
      expect(w.itemKey).toBe(CUT_ITEM_KEY);
      expect(w.area_m2).toBeCloseTo(50, 6);
    }
  });

  it('0인 쪽(성토=0)은 셀·측정을 만들지 않는다', () => {
    const result = computeSectionAreas([pv(0, 10), pv(10, 10)], [pv(0, 5), pv(10, 5)], 1);
    const plan = planSectionAssignments({ ...baseInput, result, sections: [] });
    expect(plan.measurements.every((m) => m.id !== 'm-fill')).toBe(true);
    expect(plan.writes.every((w) => w.itemKey !== FILL_ITEM_KEY)).toBe(true);
  });

  it('축척² 가 측정 value(㎡)에 반영된다', () => {
    const result = computeSectionAreas([pv(0, 10), pv(10, 10)], [pv(0, 5), pv(10, 5)], 0.01);
    const plan = planSectionAssignments({
      ...baseInput,
      scale_mPerUnit: 0.01,
      result,
      sections: [],
    });
    const cutM = plan.measurements.find((m) => m.id === 'm-cut');
    // rawValue 50(도면단위²), value = 50 × 0.01² = 0.005 ㎡
    expect(cutM?.rawValue).toBeCloseTo(50, 6);
    expect(cutM?.value).toBeCloseTo(0.005, 12);
  });
});

describe('formatSectionToast', () => {
  it('절토·성토 둘 다 있으면 병기', () => {
    const result = computeSectionAreas([pv(0, 0), pv(10, 0)], [pv(0, -5), pv(10, 5)], 1);
    const t = formatSectionToast('No.8', result);
    expect(t).toContain('절토');
    expect(t).toContain('성토');
    expect(t).toContain('자동 기입');
  });

  it('한쪽만 있으면 그쪽만', () => {
    const result = computeSectionAreas([pv(0, 10), pv(10, 10)], [pv(0, 5), pv(10, 5)], 1);
    const t = formatSectionToast('No.8', result);
    expect(t).toContain('절토');
    expect(t).not.toContain('성토');
  });
});
