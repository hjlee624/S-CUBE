import type { NEntity, NPolyline } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { entityBounds } from '../geometry/bounds.ts';
import { polylineLength } from '../geometry/primitives.ts';
import { COORD_SANE_LIMIT, isSaneCoord, sanitizeEntities } from './sanitize.ts';

const base = { handle: 'H', layer: '0' } as const;
const HUGE = 1.131929151111046e305;

describe('isSaneCoord', () => {
  it('정상 좌표(실측 규모 포함)', () => {
    expect(isSaneCoord(0)).toBe(true);
    expect(isSaneCoord(-217362.67)).toBe(true);
    expect(isSaneCoord(1e9)).toBe(true);
    expect(isSaneCoord(COORD_SANE_LIMIT)).toBe(true);
  });

  it('비유한·초과 좌표는 손상', () => {
    expect(isSaneCoord(Number.NaN)).toBe(false);
    expect(isSaneCoord(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isSaneCoord(HUGE)).toBe(false);
    expect(isSaneCoord(COORD_SANE_LIMIT * 10)).toBe(false);
    expect(isSaneCoord(-1e300)).toBe(false);
  });
});

describe('sanitizeEntities — 폴리라인 정점 제거', () => {
  it('손상 정점 제거 후 정점 ≥ 2 → 정제본 유지, count 1', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: HUGE, y: 1 }, bulge: 0 },
        { p: { x: 10, y: 10 }, bulge: 0 },
      ],
      closed: true,
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    expect(entities).toHaveLength(1);
    const poly = entities[0];
    expect(poly?.kind).toBe('polyline');
    if (poly?.kind === 'polyline') {
      expect(poly.vertices).toHaveLength(2);
      expect(poly.vertices.map((v) => v.p)).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);
    }
  });

  it('정제 후 정점 < 2 → 폴리라인 폐기, count 1', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: HUGE, y: 0 }, bulge: 0 },
        { p: { x: 1, y: Number.NaN }, bulge: 0 },
        { p: { x: 5, y: 5 }, bulge: 0 },
      ],
      closed: false,
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    expect(entities).toHaveLength(0);
  });

  it('정상 폴리라인은 참조 그대로 통과, count 0', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: 10, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(0);
    expect(entities[0]).toBe(e);
  });
});

describe('sanitizeEntities — 정의점 손상 엔티티 폐기', () => {
  it('line 끝점 손상 → 폐기', () => {
    const e: NEntity = { kind: 'line', ...base, a: { x: 0, y: 0 }, b: { x: HUGE, y: 0 } };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    expect(entities).toHaveLength(0);
  });

  it('circle 중심 손상 → 폐기', () => {
    const e: NEntity = { kind: 'circle', ...base, center: { x: Number.NaN, y: 0 }, r: 5 };
    expect(sanitizeEntities([e]).entities).toHaveLength(0);
  });

  it('arc 반지름 초과 → 폐기', () => {
    const e: NEntity = { kind: 'arc', ...base, center: { x: 0, y: 0 }, r: HUGE, a0: 0, a1: 1 };
    expect(sanitizeEntities([e]).entities).toHaveLength(0);
  });

  it('text 삽입점 손상 → 폐기', () => {
    const e: NEntity = {
      kind: 'text',
      ...base,
      pos: { x: HUGE, y: 0 },
      value: 'x',
      height: 1,
    };
    expect(sanitizeEntities([e]).entities).toHaveLength(0);
  });

  it('dimension 정의점 손상 → 폐기', () => {
    const e: NEntity = {
      kind: 'dimension',
      ...base,
      defPoints: [
        { x: 0, y: 0 },
        { x: HUGE, y: 0 },
      ],
      measuredRaw: 100,
      textOverride: null,
    };
    expect(sanitizeEntities([e]).entities).toHaveLength(0);
  });
});

describe('sanitizeEntities — 정점 제거 시 bulge 날조 방지 (critical)', () => {
  // CASE2: [(0,0,bulge=1),(HUGE,0),(100,0)] — 중간 정점 제거로 남는 (0,0)의 bulge=1이
  // (0,0)→(100,0) 세그먼트에 재적용되면 원본에 없던 반원이 날조되어 minY=-50, 길이=πr이
  // 되어야 하는데, 위생처리는 이를 막고 직선 현으로 낮춰야 한다.
  it('중간 정점 제거 시 앞 정점의 bulge를 0으로 낮춤 — 날조 원호 없음 (minY=0)', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 },
        { p: { x: HUGE, y: 0 }, bulge: 0 },
        { p: { x: 100, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    const poly = entities.find((x): x is NPolyline => x.kind === 'polyline');
    expect(poly?.vertices).toHaveLength(2);
    expect(poly?.vertices[0]?.bulge).toBe(0); // 원호 → 현으로 낮춤
    // 날조 반원(minY=-50)이 생기지 않고 직선 span의 bounds만 남는다
    const b = poly ? entityBounds(poly) : null;
    expect(b?.minY).toBe(0);
    expect(b?.maxY).toBe(0);
    // 길이도 πr(157.08)이 아니라 직선 현 길이(100)
    expect(poly ? polylineLength(poly.vertices, poly.closed) : 0).toBeCloseTo(100, 9);
  });

  it('정상 정점 사이 bulge는 보존 (뒤 정점만 제거된 경우에만 낮춤)', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 }, // 세그먼트 0→1은 정상, bulge 유지
        { p: { x: 100, y: 0 }, bulge: 1 }, // 후속(HUGE)이 제거되므로 bulge 0으로
        { p: { x: HUGE, y: 0 }, bulge: 0 },
        { p: { x: 200, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    const { entities } = sanitizeEntities([e]);
    const poly = entities.find((x): x is NPolyline => x.kind === 'polyline');
    expect(poly?.vertices).toHaveLength(3);
    expect(poly?.vertices[0]?.bulge).toBe(1); // 0→1 세그먼트 온전 → 유지
    expect(poly?.vertices[1]?.bulge).toBe(0); // 후속 제거 → 낮춤
  });

  it('폐합 폴리라인: 첫 정점 제거 시 마지막 생존 정점의 wrap bulge를 0으로', () => {
    const e: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: HUGE, y: 0 }, bulge: 0 }, // 첫 정점 제거 → wrap 세그먼트 종점 소실
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: 100, y: 0 }, bulge: 0 },
        { p: { x: 100, y: 100 }, bulge: 1 }, // 마지막 생존 정점 → wrap 세그먼트 시점
      ],
      closed: true,
    };
    const { entities } = sanitizeEntities([e]);
    const poly = entities.find((x): x is NPolyline => x.kind === 'polyline');
    expect(poly?.vertices).toHaveLength(3);
    // 마지막 생존 정점의 bulge는 마지막→첫 정점 wrap 세그먼트의 원호인데 원본 첫 정점이
    // 사라졌으므로 0으로 낮춰 날조를 막는다
    expect(poly?.vertices[poly.vertices.length - 1]?.bulge).toBe(0);
  });

  it('hatch 루프도 동일하게 bulge 날조를 막는다 (면적 오염 방지)', () => {
    const e: NEntity = {
      kind: 'hatch',
      ...base,
      loops: [
        {
          isOuter: true,
          vertices: [
            { p: { x: 0, y: 0 }, bulge: 1 },
            { p: { x: HUGE, y: 0 }, bulge: 0 },
            { p: { x: 100, y: 0 }, bulge: 0 },
            { p: { x: 100, y: 100 }, bulge: 0 },
          ],
        },
      ],
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    const hatch = entities.find((x) => x.kind === 'hatch');
    expect(hatch?.kind).toBe('hatch');
    if (hatch?.kind === 'hatch') {
      expect(hatch.loops[0]?.vertices[0]?.bulge).toBe(0); // 원호 → 현
    }
  });
});

describe('sanitizeEntities — dimension measuredRaw 범위 검사 (major)', () => {
  it('measuredRaw가 비현실적으로 큰 유한값이면 폐기 (정의점 정상이어도)', () => {
    const e: NEntity = {
      kind: 'dimension',
      ...base,
      defPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      measuredRaw: 1e300,
      textOverride: null,
    };
    const { entities, sanitizedCount } = sanitizeEntities([e]);
    expect(sanitizedCount).toBe(1);
    expect(entities).toHaveLength(0);
  });

  it('measuredRaw가 정상 범위면 유지', () => {
    const e: NEntity = {
      kind: 'dimension',
      ...base,
      defPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      measuredRaw: 100,
      textOverride: null,
    };
    expect(sanitizeEntities([e]).entities).toHaveLength(1);
  });
});

describe('sanitizeEntities — 혼합 집계', () => {
  it('정상/정제/폐기 혼합 시 count는 정제·폐기 건수만', () => {
    const good: NEntity = { kind: 'line', ...base, a: { x: 0, y: 0 }, b: { x: 1, y: 1 } };
    const dropped: NEntity = { kind: 'circle', ...base, center: { x: HUGE, y: 0 }, r: 1 };
    const cleaned: NEntity = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: HUGE, y: 0 }, bulge: 0 },
        { p: { x: 2, y: 2 }, bulge: 0 },
      ],
      closed: false,
    };
    const { entities, sanitizedCount } = sanitizeEntities([good, dropped, cleaned]);
    expect(sanitizedCount).toBe(2);
    expect(entities).toHaveLength(2); // good + cleaned
  });
});
