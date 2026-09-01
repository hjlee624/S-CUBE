/**
 * 측정 히트테스트 순수 로직 (P2-6) — 클릭 world점 → 엔티티 판정·면적/연장 자동 판별.
 *
 * scene(R-tree)·store에 의존하지 않는 순수 함수로 분리해 단위 테스트한다.
 * 오케스트레이션(R-tree 후보축소·store 반영)은 canvas/actions.ts 가 담당한다.
 *
 * 판정 규칙:
 * - 폐합 폴리라인/HATCH: 내부 클릭(pointInPolygon) 우선 → 면적(area)
 * - 그 외(line·open polyline·arc·circle 외곽·닫힌 폴리라인 경계선): 점-선 거리 ≤ tol → 연장(length)
 * - dimension: 정의점 근접 → 연장(length, measuredRaw)
 * 면적/연장 자동 판별은 엔티티 종류로 결정한다.
 */
import type { NEntity, NHatch, PVertex, Vec2 } from '@s-cube/schema';
import {
  distancePointToPolyline,
  distancePointToSegment,
  hatchArea,
  isImplicitlyClosed,
  isSelfIntersecting,
  pointInPolygon,
  polygonArea,
  polylineLength,
} from '../lib/core-api.ts';

/** 측정 종류 */
export type MeasureKind = 'area' | 'length';

/** 히트 결과 — 한 엔티티에 대한 측정 판정 */
export interface PickHit {
  /** model.entities 인덱스 */
  index: number;
  handle: string;
  layer: string;
  kind: MeasureKind;
  /** 측정 취득 방식 (Measurement.method) */
  method: 'polyline' | 'hatch' | 'dimension';
  /** 내부 포함 클릭이면 true(면적 우선), 경계선 근접이면 false */
  containment: boolean;
  /** 판정에 쓰인 거리(도면 단위). 내부 포함이면 0, 경계 근접이면 점-선 거리 */
  dist_world: number;
  entity: NEntity;
}

/**
 * 히트 엔티티의 도면 단위 원값(rawValue) + 신뢰성 플래그 산출 (순수, 도면단위).
 *
 * 캘리브레이션 축척 적용은 하지 않는다 — 축척²/축척 환산은 web 경계(lib/measure.ts).
 * - area: 면적(도면단위²). 열린 폴리라인은 시점-종점 강제폐합으로 산출하고 openGap을 표시.
 * - length: 연장(도면단위). dimension은 measuredRaw.
 */
export interface RawMeasure {
  kind: MeasureKind;
  /** 도면 단위 원값 — area: 도면단위², length: 도면단위 */
  rawValue: number;
  /** 폐합되지 않은 폴리라인을 강제폐합해 면적을 낸 경우의 시점-종점 오차거리(도면단위). 없으면 null */
  openGap: number | null;
  /** 면적 0 (퇴화 도형) 여부 */
  zeroArea: boolean;
  /** 자기교차 폴리라인 여부 (면적 신뢰성 경고) */
  selfIntersecting: boolean;
}

/** 시점-종점 강제폐합 오차거리 (도면 단위) — 열린 폴리라인 면적 측정 경고용 */
function polylineOpenGap(vertices: readonly PVertex[]): number {
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (first === undefined || last === undefined) return 0;
  return Math.hypot(last.p.x - first.p.x, last.p.y - first.p.y);
}

/**
 * 히트로부터 도면 단위 원값 산출 (순수). dimension은 measuredRaw를 넘겨받는다
 * (NDimension.measuredRaw 는 core-api 계약이 아니라 스키마 필드라 호출부가 직접 읽어 전달).
 */
export function rawMeasureOf(hit: PickHit): RawMeasure {
  const e = hit.entity;
  if (hit.kind === 'length') {
    if (e.kind === 'line') {
      return {
        kind: 'length',
        rawValue: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y),
        openGap: null,
        zeroArea: false,
        selfIntersecting: false,
      };
    }
    if (e.kind === 'polyline') {
      return {
        kind: 'length',
        rawValue: polylineLength(e.vertices, e.closed),
        openGap: null,
        zeroArea: false,
        selfIntersecting: false,
      };
    }
    if (e.kind === 'arc') {
      // 호장 = r·|a1−a0| (CCW 정규화)
      let sweep = e.a1 - e.a0;
      while (sweep < 0) sweep += Math.PI * 2;
      return {
        kind: 'length',
        rawValue: e.r * sweep,
        openGap: null,
        zeroArea: false,
        selfIntersecting: false,
      };
    }
    if (e.kind === 'dimension') {
      return {
        kind: 'length',
        rawValue: e.measuredRaw,
        openGap: null,
        zeroArea: false,
        selfIntersecting: false,
      };
    }
    return { kind: 'length', rawValue: 0, openGap: null, zeroArea: true, selfIntersecting: false };
  }
  // area
  if (e.kind === 'hatch') {
    const area = hatchArea(e.loops);
    return {
      kind: 'area',
      rawValue: area,
      openGap: null,
      zeroArea: area === 0,
      selfIntersecting: false,
    };
  }
  if (e.kind === 'circle') {
    const area = Math.PI * e.r * e.r;
    return {
      kind: 'area',
      rawValue: area,
      openGap: null,
      zeroArea: area === 0,
      selfIntersecting: false,
    };
  }
  if (e.kind === 'polyline') {
    // 실제 폐합성(e.closed)을 넘긴다 — 열린 폴리라인은 시점-종점을 **직선**으로 폐합하고
    // 마지막 정점의 bulge 를 (존재하지 않는) 폐합 세그먼트에 잘못 적용하지 않는다.
    // (closed=true 로 강제하면 마지막 정점 bulge 가 자동폐합 변에 얹혀 면적이 부풀려진다.)
    const area = polygonArea(e.vertices, e.closed);
    const openGap = e.closed ? null : polylineOpenGap(e.vertices);
    return {
      kind: 'area',
      rawValue: area,
      openGap,
      zeroArea: area === 0,
      selfIntersecting: isSelfIntersecting(e.vertices),
    };
  }
  return { kind: 'area', rawValue: 0, openGap: null, zeroArea: true, selfIntersecting: false };
}

/** HATCH의 island(구멍) 루프 handle 수집 — 순수. 현재 스키마는 loop별 handle이 없어 빈 배열 */
export function holeHandlesOf(_hatch: NHatch): string[] {
  return [];
}

/** 원 외곽선까지의 최단거리 (도면 단위) */
function distancePointToCircle(p: Vec2, center: Vec2, r: number): number {
  return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r);
}

/** 원호 근사 — 정의상 원 외곽 거리로 근사(호 범위 밖 오차는 tol 내 미미) */
function distancePointToArc(p: Vec2, center: Vec2, r: number): number {
  return distancePointToCircle(p, center, r);
}

/** dimension 정의점 폴리라인(연결선)까지의 최단거리 */
function distancePointToDefPoints(p: Vec2, defPoints: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < defPoints.length - 1; i++) {
    const a = defPoints[i];
    const b = defPoints[i + 1];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, distancePointToSegment(p, a, b));
  }
  // 세그먼트가 없으면(정의점 1개) 그 점까지의 거리
  if (!Number.isFinite(best)) {
    const only = defPoints[0];
    if (only !== undefined) best = Math.hypot(p.x - only.x, p.y - only.y);
  }
  return best;
}

/**
 * HATCH 외곽 루프 내부 포함 판정 — 외곽(isOuter, 없으면 첫 루프) 안에 있는가.
 * island(구멍) 차감은 면적 계산(hatchArea)에서 처리하고, 여기선 클릭이 도형 위인지만 본다.
 */
function hatchContains(
  loops: readonly { vertices: PVertex[]; isOuter: boolean }[],
  p: Vec2,
): boolean {
  const outer = loops.filter((l) => l.isOuter);
  const targets = outer.length > 0 ? outer : loops;
  return targets.some((l) => pointInPolygon(p, l.vertices));
}

/**
 * 한 엔티티에 대해 클릭 판정 — 히트면 PickHit, 아니면 null (순수).
 * @param tol_world 경계선 근접 허용거리(도면 단위, px→world 환산 후)
 */
export function hitTestEntity(
  entity: NEntity,
  index: number,
  p: Vec2,
  tol_world: number,
): PickHit | null {
  const base = { index, handle: entity.handle, layer: entity.layer, entity };
  switch (entity.kind) {
    case 'polyline': {
      // 내부 클릭 우선(면적). 폐합 폴리라인은 물론, 열린 폴리라인이라도 시점≠종점이라
      // 암묵 폐합 가능(isImplicitlyClosed)하면 내부 영역 클릭을 면적으로 라우팅한다 —
      // 이때 rawMeasureOf 가 시점-종점 강제폐합 면적 + openGap 을 산출하고(P2-12),
      // 오케스트레이터(actions.ts)가 '폐합되지 않음' 경고 토스트를 띄운다.
      const areaCloseable = entity.closed || isImplicitlyClosed(entity.vertices, entity.closed);
      if (areaCloseable && pointInPolygon(p, entity.vertices)) {
        return { ...base, kind: 'area', method: 'polyline', containment: true, dist_world: 0 };
      }
      const d = distancePointToPolyline(p, entity.vertices, entity.closed);
      if (d <= tol_world) {
        // 닫힌 폴리라인 경계선을 집으면 면적으로 취급(도형 자체가 폐합 영역).
        // 열린 폴리라인 경계선은 연장(선 자체 길이)으로 — 면적은 내부 클릭 의도일 때만.
        const kind: MeasureKind = entity.closed ? 'area' : 'length';
        return { ...base, kind, method: 'polyline', containment: false, dist_world: d };
      }
      return null;
    }
    case 'hatch': {
      if (hatchContains(entity.loops, p)) {
        return { ...base, kind: 'area', method: 'hatch', containment: true, dist_world: 0 };
      }
      // 내부가 아니어도 경계선 근접이면 면적 대상으로 인정
      let best = Number.POSITIVE_INFINITY;
      for (const loop of entity.loops) {
        best = Math.min(best, distancePointToPolyline(p, loop.vertices, true));
      }
      if (best <= tol_world) {
        return { ...base, kind: 'area', method: 'hatch', containment: false, dist_world: best };
      }
      return null;
    }
    case 'line': {
      const d = distancePointToSegment(p, entity.a, entity.b);
      if (d <= tol_world) {
        return { ...base, kind: 'length', method: 'polyline', containment: false, dist_world: d };
      }
      return null;
    }
    case 'arc': {
      const d = distancePointToArc(p, entity.center, entity.r);
      if (d <= tol_world) {
        return { ...base, kind: 'length', method: 'polyline', containment: false, dist_world: d };
      }
      return null;
    }
    case 'circle': {
      // 원은 폐합 도형 → 내부 클릭(면적) 우선, 외곽선 근접(면적)
      const distToEdge = distancePointToCircle(p, entity.center, entity.r);
      const inside = Math.hypot(p.x - entity.center.x, p.y - entity.center.y) <= entity.r;
      if (inside) {
        return { ...base, kind: 'area', method: 'polyline', containment: true, dist_world: 0 };
      }
      if (distToEdge <= tol_world) {
        return {
          ...base,
          kind: 'area',
          method: 'polyline',
          containment: false,
          dist_world: distToEdge,
        };
      }
      return null;
    }
    case 'dimension': {
      const d = distancePointToDefPoints(p, entity.defPoints);
      if (d <= tol_world) {
        return { ...base, kind: 'length', method: 'dimension', containment: false, dist_world: d };
      }
      return null;
    }
    default:
      // text 등 측정 비대상
      return null;
  }
}

/**
 * 후보 히트들 중 최적 하나 선택 (순수).
 *
 * 우선순위:
 * 1. 내부 포함(containment=true) 히트를 경계 근접보다 우선 — 영역 클릭 의도를 존중.
 *    포함 히트가 여럿이면 면적이 가장 작은 것(가장 안쪽·구체적 도형)을 고른다.
 * 2. 포함이 없으면 경계 거리(dist_world)가 가장 가까운 것.
 *
 * @param areaOf 포함 히트 간 우열용 면적 추정기(도면단위²). 없으면 index 순.
 */
export function pickBest(
  hits: readonly PickHit[],
  areaOf?: (h: PickHit) => number,
): PickHit | null {
  const contained = hits.filter((h) => h.containment);
  if (contained.length > 0) {
    if (areaOf === undefined) return contained[0] ?? null;
    let best = contained[0] ?? null;
    let bestArea = best === null ? Number.POSITIVE_INFINITY : areaOf(best);
    for (const h of contained) {
      const a = areaOf(h);
      if (a < bestArea) {
        best = h;
        bestArea = a;
      }
    }
    return best;
  }
  let best: PickHit | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const h of hits) {
    if (h.dist_world < bestDist) {
      best = h;
      bestDist = h.dist_world;
    }
  }
  return best;
}
