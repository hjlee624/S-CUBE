/**
 * 좌표 위생처리 — 손상 데이터(쓰레기 좌표)로 오염된 정규화 엔티티를 걸러낸다.
 *
 * 일부 DXF는 폴리라인 정점 등에 비유한(NaN/Infinity)·비현실적으로 큰(예: 1e305) 좌표가
 * 섞여 들어온다(파일 손상·미초기화 메모리 등). 이런 값 하나가 model.bounds를 무한대 규모로
 * 오염시켜 zoomToExtents가 실제 도면을 못 맞추는 근본 원인이 된다.
 *
 * 대응(P1-2: 조용히 버리지 않기):
 * - polyline/hatch loop: 손상 정점 제거, 정제 후 정점 < 2개면 해당 폴리라인/루프 폐기.
 *   정점 제거 시 후속 정점이 사라진 생존 정점의 bulge를 0으로 낮춰(원호→현) 원본에 없던
 *   원호가 gap을 가로지르며 날조되는 것을 막는다(sanitizeVertices 참조).
 * - line/arc/circle/text/dimension: 정의점(또는 반지름)이 손상이면 엔티티 폐기.
 *   dimension의 measuredRaw는 좌표 정상 범위(isSaneCoord)까지 검사한다.
 * - 폐기·정제 건수를 집계해 반환한다(엔티티 1건당 최대 1로 카운트)
 *
 * 2차 패스(상대 좌표 이상치): 절대 임계 아래이지만 도면의 나머지 대비 극단적으로 멀리
 * 떨어진 엔티티(예: 폴리라인 정점 하나가 ~1e11이라 bbox 중심이 도면 밖으로 튄 경우)를
 * 도면 자체 좌표 분포 기준으로 검출해 폐기한다(outlier.ts). 절대 임계만으로는 못 잡는
 * bounds 오염(Zoom Extents가 실제 도면을 세로선 하나로 찌그러뜨림)을 제거한다.
 */
import type { Loop, NEntity, PVertex, Vec2 } from '@s-cube/schema';
import { entityBounds } from '../geometry/bounds.ts';
import {
  type Center,
  classifyCenterOutliers,
  computeOutlierCriteria,
  isSpanOutlier,
} from './outlier.ts';

/**
 * 좌표 성분의 정상 범위 상한(절대값). 실측 좌표는 mm 단위라도 최대 ~1e9 규모이므로
 * 1e12를 넘거나 비유한이면 손상 데이터로 간주한다.
 */
export const COORD_SANE_LIMIT = 1e12;

/** 값 하나가 정상 좌표 성분인가 (유한 + 절대값 ≤ 상한) */
export function isSaneCoord(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= COORD_SANE_LIMIT;
}

/** 점의 두 성분이 모두 정상인가 */
function isSaneVec2(p: Vec2): boolean {
  return isSaneCoord(p.x) && isSaneCoord(p.y);
}

/** 반지름이 정상인가 (유한 + 0 이상 + 상한 이하) */
function isSaneRadius(r: number): boolean {
  return Number.isFinite(r) && r >= 0 && r <= COORD_SANE_LIMIT;
}

/**
 * 손상 정점을 제거한 정점열 (원본 순서 보존).
 *
 * bulge 재타겟 방지(P1-2 critical): 폴리라인에서 vertices[i].bulge는 세그먼트 i→i+1의
 * 원호를 정의한다. 단순 filter로 i+1을 제거하면 i의 bulge가 i→(다음 생존 정점)에 잘못
 * 적용되어 원본에 없던 원호가 날조된다(면적·길이·둘레 실측 오염). 이를 막기 위해:
 * - 후속 정점이 제거된 생존 정점의 bulge를 0으로 낮춰(원호→현) 합성 세그먼트가 gap을
 *   가로지르지 않게 한다.
 * - 폐합(closed) 폴리라인은 마지막 정점의 bulge가 마지막→첫 정점 세그먼트에 적용되므로,
 *   첫 정점이 제거됐거나 마지막 정점이 제거되면 마지막 생존 정점의 bulge도 0으로 낮춘다.
 *
 * @param closed 폐합 여부 — 마지막→첫 정점 wrap 세그먼트 처리에 사용
 */
function sanitizeVertices(vertices: PVertex[], closed: boolean): PVertex[] {
  const n = vertices.length;
  const out: PVertex[] = [];
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    if (v === undefined || !isSaneVec2(v.p)) continue;
    // 바로 다음 정점(원본 순서상 후속)이 제거되면 이 정점의 bulge는 사라진 세그먼트의
    // 원호이므로 0으로 낮춘다(생존한 그다음 정점에 재적용되는 날조를 차단).
    const successor = vertices[i + 1];
    const successorDropped = i + 1 < n && (successor === undefined || !isSaneVec2(successor.p));
    out.push(successorDropped && v.bulge !== 0 ? { ...v, bulge: 0 } : v);
  }
  // 폐합 폴리라인: 마지막 생존 정점의 bulge는 마지막→첫 정점 wrap 세그먼트의 원호다.
  // 원본 첫 정점이 제거됐거나 원본 마지막 정점이 제거됐다면 이 wrap 세그먼트의 종점/시점이
  // 사라진 것이므로 마지막 생존 정점의 bulge를 0으로 낮춘다.
  if (closed && out.length >= 2) {
    const firstDropped = vertices.length > 0 && !isSaneVec2((vertices[0] as PVertex).p);
    const lastOriginal = vertices[n - 1];
    const lastDropped = lastOriginal === undefined || !isSaneVec2(lastOriginal.p);
    if (firstDropped || lastDropped) {
      const last = out[out.length - 1];
      if (last !== undefined && last.bulge !== 0) out[out.length - 1] = { ...last, bulge: 0 };
    }
  }
  return out;
}

/**
 * 위생처리 결과. entities는 정상 엔티티만, sanitizedCount는 폐기·정제된 엔티티 수(엔티티당 최대 1).
 */
export interface SanitizeResult {
  entities: NEntity[];
  sanitizedCount: number;
}

/**
 * 엔티티 1건 위생처리. 정상이면 그대로, 정제되면 정제본, 폐기 대상이면 null을 반환한다.
 * changed 콜백은 원본이 변경(정점 제거)되거나 폐기될 때 호출된다.
 */
function sanitizeEntity(e: NEntity, onChanged: () => void): NEntity | null {
  switch (e.kind) {
    case 'line': {
      if (isSaneVec2(e.a) && isSaneVec2(e.b)) return e;
      onChanged();
      return null;
    }
    case 'arc': {
      if (isSaneVec2(e.center) && isSaneRadius(e.r) && isSaneCoord(e.a0) && isSaneCoord(e.a1)) {
        return e;
      }
      onChanged();
      return null;
    }
    case 'circle': {
      if (isSaneVec2(e.center) && isSaneRadius(e.r)) return e;
      onChanged();
      return null;
    }
    case 'text': {
      if (isSaneVec2(e.pos)) return e;
      onChanged();
      return null;
    }
    case 'dimension': {
      const defPoints = e.defPoints.filter(isSaneVec2);
      // 정의점이 하나라도 손상이면(개수 감소) 치수 도형이 왜곡되므로 엔티티를 폐기한다.
      // measuredRaw는 실측 수량에 직접 쓰이므로 유한성만이 아니라 좌표 정상 범위까지 검사해
      // 비현실적으로 큰 유한값(예: 1e300)이 수량을 오염시키지 않게 한다.
      if (defPoints.length !== e.defPoints.length || !isSaneCoord(e.measuredRaw)) {
        onChanged();
        return null;
      }
      return e;
    }
    case 'polyline': {
      const vertices = sanitizeVertices(e.vertices, e.closed);
      // 정점이 하나도 제거되지 않았으면 bulge 재타겟도 없었으므로 참조 그대로 통과
      if (vertices.length === e.vertices.length) return e;
      onChanged();
      if (vertices.length < 2) return null;
      return { ...e, vertices };
    }
    case 'hatch': {
      let loopChanged = false;
      const loops: Loop[] = [];
      for (const loop of e.loops) {
        // HATCH 경계 루프는 항상 폐합으로 취급(면적 계산 대상) — wrap 세그먼트 bulge 처리
        const vertices = sanitizeVertices(loop.vertices, true);
        if (vertices.length !== loop.vertices.length) loopChanged = true;
        if (vertices.length < 2) continue; // 정점 부족 루프 폐기
        loops.push(vertices.length === loop.vertices.length ? loop : { ...loop, vertices });
      }
      if (!loopChanged) return e;
      onChanged();
      if (loops.length === 0) return null;
      return { ...e, loops };
    }
  }
}

/**
 * 2차 패스 — 상대 좌표 이상치 폐기.
 *
 * 절대-임계 위생처리 후 남은 엔티티의 bbox 분포를 기준으로 두 종류의 이상치를 폐기한다:
 *
 *  (1) 중심 이동(center-shift): bbox 중심이 도면 중앙값에서 cutoff를 초과해 벗어난 엔티티.
 *      단, cutoff를 넘는 중심점이라도 서로 뭉쳐 있는 소수 클러스터(≥ minCluster)는 정상
 *      부속(범례·북방위표·상세도·제2 도곽)으로 보고 보호한다(classifyCenterOutliers).
 *      고립되었거나 소수만 뭉친 중심만 폐기한다.
 *  (2) span 팽창(span-inflation): 중심은 도면 안이지만 bbox가 cutoff보다 큰 엔티티. 정점
 *      하나가 ~1e11이라 대칭이라도 span만 1e11로 부푼 손상(중심-기반으로는 못 잡음)을 잡아
 *      bounds 오염(Zoom Extents가 도면을 세로선 하나로 찌그러뜨림)을 막는다.
 *
 * bbox 계산이 불가한(중심/span 없는) 엔티티는 이상치 판정 대상에서 제외하되 그대로 유지한다.
 *
 * 보수성: 중심점 수가 부족하면(computeOutlierCriteria가 null) 검출을 생략한다.
 */
function dropRelativeOutliers(entities: readonly NEntity[]): SanitizeResult {
  // 각 엔티티에 bbox 중심·span을 짝지어 둔다(bbox 계산 불가는 null).
  const withMetrics = entities.map((e) => {
    const b = entityBounds(e);
    if (b === null)
      return { entity: e, center: null as Center | null, span: null as number | null };
    const center: Center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    return { entity: e, center, span };
  });
  const present: Center[] = [];
  for (const { center } of withMetrics) {
    if (center !== null) present.push(center);
  }
  const criteria = computeOutlierCriteria(present);
  // 데이터 부족(중심점 < 최소치) → 상대 검출 생략, 전부 유지.
  if (criteria === null) return { entities: [...entities], sanitizedCount: 0 };
  // 중심-이동 이상치 분류(정상 제2 클러스터 보호). present 순서와 대응한다.
  const centerDrop = classifyCenterOutliers(present, criteria);
  const out: NEntity[] = [];
  let sanitizedCount = 0;
  let presentIdx = 0;
  for (const { entity, center, span } of withMetrics) {
    if (center !== null && span !== null) {
      const dropByCenter = centerDrop[presentIdx] === true;
      presentIdx += 1;
      // 중심-이동(고립 이상치) 또는 span-팽창 중 하나라도 걸리면 폐기.
      if (dropByCenter || isSpanOutlier(span, criteria)) {
        sanitizedCount += 1;
        continue;
      }
    }
    // 중심/span을 못 구한 엔티티는 이상치 판정에서 제외하고 유지.
    out.push(entity);
  }
  return { entities: out, sanitizedCount };
}

/**
 * 정규화 엔티티 목록의 좌표 위생처리 — 손상 정점 제거·손상 엔티티 폐기.
 * 최종 model.bounds가 정상 엔티티만 반영하도록 파이프라인에서 정규화 직후 호출한다.
 *
 * 두 패스로 구성한다:
 *  1) 절대-임계 위생처리(비유한·비현실적 초과 좌표 제거 — sanitizeEntity)
 *  2) 상대 좌표 이상치 폐기(1차 통과 엔티티 대비 극단적으로 먼 bbox 중심 제거 —
 *     dropRelativeOutliers). 두 패스의 sanitizedCount는 합산한다.
 */
export function sanitizeEntities(entities: readonly NEntity[]): SanitizeResult {
  const out: NEntity[] = [];
  let sanitizedCount = 0;
  for (const e of entities) {
    let changed = false;
    const kept = sanitizeEntity(e, () => {
      changed = true;
    });
    if (changed) sanitizedCount += 1;
    if (kept !== null) out.push(kept);
  }
  // 2차: 절대-임계 통과 엔티티 분포 기준 상대 이상치 폐기.
  const relative = dropRelativeOutliers(out);
  return {
    entities: relative.entities,
    sanitizedCount: sanitizedCount + relative.sanitizedCount,
  };
}
