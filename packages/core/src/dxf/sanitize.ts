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
 */
import type { Loop, NEntity, PVertex, Vec2 } from '@s-cube/schema';

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
 * 정규화 엔티티 목록의 좌표 위생처리 — 손상 정점 제거·손상 엔티티 폐기.
 * 최종 model.bounds가 정상 엔티티만 반영하도록 파이프라인에서 정규화 직후 호출한다.
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
  return { entities: out, sanitizedCount };
}
