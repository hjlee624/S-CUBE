/**
 * 측정 히트테스트 판별 로직 테스트 (P2-6) — 면적/연장 자동 판별·포함 우선·최근접 선택.
 *
 * core-api 기하 함수(core 병렬 구현 중)는 결정적 스텁으로 모킹해, pick의 판별 로직만 검증한다.
 * (core 실함수의 수치 정확성은 packages/core 테스트가 담당 — 여기선 UI 판별 규칙만 못박는다.)
 */
import type { NEntity, PVertex, Vec2 } from '@s-cube/schema';
import { describe, expect, it, vi } from 'vitest';

// 정사각형/거리 판정을 결정적으로 만드는 최소 스텁.
vi.mock('../lib/core-api.ts', () => ({
  // 폴리곤을 [minX,minY,maxX,maxY] AABB로 간주해 내부 판정 (테스트 도형이 축정렬 사각형이라 정확)
  pointInPolygon: (p: Vec2, vertices: PVertex[]): boolean => {
    const xs = vertices.map((v) => v.p.x);
    const ys = vertices.map((v) => v.p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  },
  distancePointToSegment: (p: Vec2, a: Vec2, b: Vec2): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  },
  distancePointToPolyline: (p: Vec2, vertices: PVertex[], closed: boolean): number => {
    let best = Number.POSITIVE_INFINITY;
    const n = vertices.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = vertices[i]?.p;
      const b = vertices[(i + 1) % n]?.p;
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let d: number;
      if (len2 === 0) d = Math.hypot(p.x - a.x, p.y - a.y);
      else {
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      }
      best = Math.min(best, d);
    }
    return best;
  },
  // core.polygonArea 계약 충실 재현 — closed 인자와 bulge 활꼴 보정을 모두 반영해야
  // "열린 폴리라인은 마지막 정점 bulge 를 자동폐합 변에 얹지 않는다"(P2-12)를 검증할 수 있다.
  polygonArea: (vertices: PVertex[], closed: boolean): number => {
    const n = vertices.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = vertices[i]?.p;
      const b = vertices[(i + 1) % n]?.p;
      if (a === undefined || b === undefined) continue;
      s += a.x * b.y - b.x * a.y;
    }
    let area = s / 2;
    // 원호 활꼴 보정 — closed면 마지막→첫 세그먼트까지(n), 열림이면 마지막 정점 제외(n-1).
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const v0 = vertices[i];
      const v1 = vertices[(i + 1) % n];
      if (v0 === undefined || v1 === undefined) continue;
      if (v0.bulge === 0) continue;
      const dx = v1.p.x - v0.p.x;
      const dy = v1.p.y - v0.p.y;
      const chord = Math.hypot(dx, dy);
      if (chord === 0) continue;
      const theta = 4 * Math.atan(v0.bulge);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      area += 0.5 * r * r * (theta - Math.sin(theta));
    }
    return Math.abs(area);
  },
  isImplicitlyClosed: (vertices: PVertex[], closed: boolean): boolean => {
    if (closed) return false;
    const n = vertices.length;
    if (n < 3) return false;
    const first = vertices[0]?.p;
    const last = vertices[n - 1]?.p;
    if (first === undefined || last === undefined) return false;
    return Math.hypot(first.x - last.x, first.y - last.y) > 0;
  },
  hatchArea: () => 100,
  polylineLength: () => 40,
  isSelfIntersecting: () => false,
}));

const { hitTestEntity, pickBest, rawMeasureOf } = await import('./pick.ts');
type PickHit = Awaited<ReturnType<typeof hitTestEntity>>;

/** PickHit 테스트 팩토리 — pickBest 우선순위 검증용 */
function hit(overrides: Partial<NonNullable<PickHit>>): NonNullable<PickHit> {
  return {
    index: 0,
    handle: 'X',
    layer: 'L',
    kind: 'area',
    method: 'polyline',
    containment: false,
    dist_world: 0,
    entity: {} as NEntity,
    ...overrides,
  };
}

/** 축정렬 사각형 폴리라인 정점 */
function square(x0: number, y0: number, size: number): PVertex[] {
  return [
    { p: { x: x0, y: y0 }, bulge: 0 },
    { p: { x: x0 + size, y: y0 }, bulge: 0 },
    { p: { x: x0 + size, y: y0 + size }, bulge: 0 },
    { p: { x: x0, y: y0 + size }, bulge: 0 },
  ];
}

describe('hitTestEntity — 면적/연장 자동 판별', () => {
  it('폐합 폴리라인 내부 클릭 → 면적(area, containment)', () => {
    const e: NEntity = {
      kind: 'polyline',
      handle: 'P1',
      layer: 'L',
      vertices: square(0, 0, 10),
      closed: true,
    };
    const hit = hitTestEntity(e, 0, { x: 5, y: 5 }, 0.5);
    expect(hit?.kind).toBe('area');
    expect(hit?.method).toBe('polyline');
    expect(hit?.containment).toBe(true);
    expect(hit?.dist_world).toBe(0);
  });

  it('열린 폴리라인 외곽 경계 근접(내부 아님) → 연장(length)', () => {
    const e: NEntity = {
      kind: 'polyline',
      handle: 'P2',
      layer: 'L',
      vertices: square(0, 0, 10),
      closed: false,
    };
    // 첫 세그먼트 (0,0)-(10,0) '바깥쪽'(y<0) 근접 — 내부 클릭이 아니므로 연장으로 판정.
    const hit = hitTestEntity(e, 0, { x: 5, y: -0.1 }, 0.5);
    expect(hit?.kind).toBe('length');
    expect(hit?.containment).toBe(false);
  });

  it('열린 폴리라인이지만 암묵 폐합 가능 + 내부 클릭 → 면적(area, containment) (P2-12)', () => {
    // 시점(0,0)≠종점(0,10)이라 isImplicitlyClosed=true → 내부 클릭을 면적으로 라우팅.
    const e: NEntity = {
      kind: 'polyline',
      handle: 'P3',
      layer: 'L',
      vertices: square(0, 0, 10),
      closed: false,
    };
    const hit = hitTestEntity(e, 0, { x: 5, y: 5 }, 0.5);
    expect(hit?.kind).toBe('area');
    expect(hit?.method).toBe('polyline');
    expect(hit?.containment).toBe(true);
    // 강제폐합 면적 + openGap 이 산출돼 '폐합되지 않음' 경고 경로가 실제로 도달 가능해야 한다.
    if (hit === null) throw new Error('hit expected');
    const raw = rawMeasureOf(hit);
    expect(raw.kind).toBe('area');
    expect(raw.rawValue).toBeCloseTo(100, 12);
    expect(raw.openGap).toBeCloseTo(10, 12); // 시점(0,0)-종점(0,10) 오차거리
  });

  it('선(line) 근접 → 연장', () => {
    const e: NEntity = {
      kind: 'line',
      handle: 'LN',
      layer: 'L',
      a: { x: 0, y: 0 },
      b: { x: 10, y: 0 },
    };
    expect(hitTestEntity(e, 0, { x: 5, y: 0.2 }, 0.5)?.kind).toBe('length');
    // 허용거리 밖이면 null
    expect(hitTestEntity(e, 0, { x: 5, y: 5 }, 0.5)).toBeNull();
  });

  it('HATCH 내부 클릭 → 면적(hatch)', () => {
    const e: NEntity = {
      kind: 'hatch',
      handle: 'H1',
      layer: 'L',
      loops: [{ vertices: square(0, 0, 20), isOuter: true }],
    };
    const hit = hitTestEntity(e, 0, { x: 10, y: 10 }, 0.5);
    expect(hit?.kind).toBe('area');
    expect(hit?.method).toBe('hatch');
    expect(hit?.containment).toBe(true);
  });

  it('원 내부 클릭 → 면적', () => {
    const e: NEntity = { kind: 'circle', handle: 'C1', layer: 'L', center: { x: 0, y: 0 }, r: 5 };
    expect(hitTestEntity(e, 0, { x: 1, y: 1 }, 0.5)?.kind).toBe('area');
  });

  it('치수(dimension) 근접 → 연장(dimension method)', () => {
    const e: NEntity = {
      kind: 'dimension',
      handle: 'D1',
      layer: 'L',
      defPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      measuredRaw: 10,
      textOverride: null,
    };
    const hit = hitTestEntity(e, 0, { x: 5, y: 0.1 }, 0.5);
    expect(hit?.kind).toBe('length');
    expect(hit?.method).toBe('dimension');
  });

  it('텍스트는 측정 비대상 → null', () => {
    const e: NEntity = {
      kind: 'text',
      handle: 'T1',
      layer: 'L',
      pos: { x: 0, y: 0 },
      value: 'hi',
      height: 2,
    };
    expect(hitTestEntity(e, 0, { x: 0, y: 0 }, 0.5)).toBeNull();
  });
});

describe('pickBest — 포함 우선·최소면적·최근접', () => {
  it('내부 포함 히트를 경계 근접 히트보다 우선', () => {
    const contained = hit({ handle: 'A', kind: 'area', containment: true, dist_world: 0 });
    const edge = hit({ handle: 'B', kind: 'length', containment: false, dist_world: 0.01 });
    expect(pickBest([edge, contained])?.handle).toBe('A');
  });

  it('포함 히트가 여럿이면 면적이 가장 작은(안쪽) 것', () => {
    const big = hit({ handle: 'BIG', kind: 'area', containment: true });
    const small = hit({ handle: 'SMALL', kind: 'area', containment: true });
    const areaOf = (h: NonNullable<PickHit>) => (h.handle === 'BIG' ? 1000 : 10);
    expect(pickBest([big, small], areaOf)?.handle).toBe('SMALL');
  });

  it('포함이 없으면 경계 거리 최근접', () => {
    const far = hit({ handle: 'FAR', kind: 'length', containment: false, dist_world: 0.4 });
    const near = hit({ handle: 'NEAR', kind: 'length', containment: false, dist_world: 0.05 });
    expect(pickBest([far, near])?.handle).toBe('NEAR');
  });

  it('빈 후보는 null', () => {
    expect(pickBest([])).toBeNull();
  });
});

describe('rawMeasureOf — 도면단위 원값 산출', () => {
  it('line 연장 = 두 점 거리(도면단위)', () => {
    const e: NEntity = {
      kind: 'line',
      handle: 'LN',
      layer: 'L',
      a: { x: 0, y: 0 },
      b: { x: 3, y: 4 },
    };
    const hit = hitTestEntity(e, 0, { x: 1.5, y: 2 }, 100);
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(rawMeasureOf(hit).rawValue).toBeCloseTo(5, 12);
  });

  it('폐합 폴리라인 면적 = shoelace(도면단위²)', () => {
    const e: NEntity = {
      kind: 'polyline',
      handle: 'P',
      layer: 'L',
      vertices: square(0, 0, 10),
      closed: true,
    };
    const hit = hitTestEntity(e, 0, { x: 5, y: 5 }, 0.5);
    if (hit === null) throw new Error('hit expected');
    const raw = rawMeasureOf(hit);
    expect(raw.kind).toBe('area');
    expect(raw.rawValue).toBeCloseTo(100, 12); // 10×10
    expect(raw.openGap).toBeNull();
  });

  it('열린 폴리라인을 면적으로 측정하면 openGap(강제폐합 오차거리)을 보고한다 (P2-12)', () => {
    // 시점(0,0)·종점(0,10)이 벌어진 열린 폴리라인 → gap = 10.
    // rawMeasureOf를 area 히트로 직접 호출(강제폐합 경로) — 경계 근접 pick은 length라 여기선
    // area 히트를 구성해 openGap 산출만 검증한다.
    const open: PVertex[] = [
      { p: { x: 0, y: 0 }, bulge: 0 },
      { p: { x: 10, y: 0 }, bulge: 0 },
      { p: { x: 10, y: 10 }, bulge: 0 },
      { p: { x: 0, y: 10 }, bulge: 0 },
    ];
    const e: NEntity = {
      kind: 'polyline',
      handle: 'OP',
      layer: 'L',
      vertices: open,
      closed: false,
    };
    const areaHit = {
      index: 0,
      handle: 'OP',
      layer: 'L',
      kind: 'area' as const,
      method: 'polyline' as const,
      containment: true,
      dist_world: 0,
      entity: e,
    };
    const raw = rawMeasureOf(areaHit);
    expect(raw.kind).toBe('area');
    expect(raw.openGap).toBeCloseTo(10, 12); // 시점-종점 직선 폐합 오차거리
    expect(raw.rawValue).toBeCloseTo(100, 12); // 강제폐합 면적
  });

  it('열린 폴리라인 면적은 마지막 정점 bulge 를 자동폐합 변에 얹지 않는다 (closed=false)', () => {
    // 열린 직사각 경로의 마지막 정점 bulge=2. closed=true 로 강제하면 존재하지 않는
    // (마지막→첫) 폐합 변에 원호가 얹혀 205.246 으로 부풀지만, e.closed(false)를 넘기면
    // 폐합 변은 직선이라 정답 100 이 나온다 (P2-12 강제폐합은 직선 폐합).
    const open: PVertex[] = [
      { p: { x: 0, y: 0 }, bulge: 0 },
      { p: { x: 10, y: 0 }, bulge: 0 },
      { p: { x: 10, y: 10 }, bulge: 0 },
      { p: { x: 0, y: 10 }, bulge: 2 }, // 마지막 정점에 곡률 — 폐합 변엔 적용되면 안 됨
    ];
    const e: NEntity = {
      kind: 'polyline',
      handle: 'OPB',
      layer: 'L',
      vertices: open,
      closed: false,
    };
    const areaHit = {
      index: 0,
      handle: 'OPB',
      layer: 'L',
      kind: 'area' as const,
      method: 'polyline' as const,
      containment: true,
      dist_world: 0,
      entity: e,
    };
    const raw = rawMeasureOf(areaHit);
    expect(raw.rawValue).toBeCloseTo(100, 9); // closed=false → 직선 폐합, bulge 미적용
    // 회귀 방지: closed=true 로 잘못 강제하면 나오던 205.246 이 아니어야 한다.
    expect(raw.rawValue).not.toBeCloseTo(205.246, 2);
  });
});
