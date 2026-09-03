/**
 * 교차점(intersection) 스냅 순수 기하 — 커서 주변 두 세그먼트의 교점 계산 (RW-3 / P1-10·P2-15).
 *
 * scene(R-tree)·store·렌더러에 의존하지 않는 순수 함수로 분리해 단위 테스트한다.
 * 오케스트레이션(R-tree 후보축소·우선순위 선택·overlay 반영)은 canvas/snap.ts 가 담당한다.
 *
 * 설계:
 * - 모든 엔티티를 **직선 세그먼트열**로 분해한다(line/polyline 직선변 그대로, arc·bulge 세그먼트·
 *   circle 은 bulgeToArc/각도로 원호화한 뒤 폴리라인 근사). 이렇게 하면 line-line·line-arc·
 *   arc-arc 교점을 모두 **선분-선분 교차** 한 종류로 통일해 처리한다(원호는 근사 허용).
 * - core 가 병렬로 추가하는 신규 엔티티(HATCH 경계, ELLIPSE/SPLINE 폴리라인 근사)도
 *   line/polyline/arc 로 들어오면 자동 수용된다.
 */
import type { NEntity, Vec2 } from '@s-cube/schema';
import { bulgeToArc } from '../lib/core-api.ts';

/** 직선 세그먼트 (교차 계산 단위) */
export interface Seg {
  a: Vec2;
  b: Vec2;
}

/** 원호를 폴리라인 근사할 때 한 세그먼트가 커버하는 최대 각도(라디안). 작을수록 정밀. */
const ARC_STEP = Math.PI / 24; // 7.5°
/** 근사 세그먼트 수 상한 — 극단적으로 큰 원이 성능을 먹지 않도록 */
const ARC_MAX_STEPS = 96;
/** 두 교점이 사실상 같은 점인지 판정하는 상대 허용오차(도면 단위 절대치는 호출부 tol로 걸러짐) */
const SAME_POINT_EPS = 1e-9;

/**
 * 원호(center, r, a0→a1)를 직선 세그먼트열로 근사해 out 에 push.
 * ccw=true 면 a0→a1 를 반시계로, false 면 시계로 훑는다.
 */
export function tessellateArc(
  center: Vec2,
  r: number,
  a0: number,
  a1: number,
  ccw: boolean,
  out: Seg[],
): void {
  if (!(r > 0) || !Number.isFinite(r)) return;
  // 스윕각을 [0, 2π) 로 정규화 (방향 반영)
  let sweep = ccw ? a1 - a0 : a0 - a1;
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  if (sweep === 0) sweep = Math.PI * 2; // 완전한 원(a0==a1)
  const steps = Math.min(ARC_MAX_STEPS, Math.max(1, Math.ceil(sweep / ARC_STEP)));
  const dir = ccw ? 1 : -1;
  let prev: Vec2 = {
    x: center.x + r * Math.cos(a0),
    y: center.y + r * Math.sin(a0),
  };
  for (let i = 1; i <= steps; i++) {
    const ang = a0 + dir * sweep * (i / steps);
    const cur: Vec2 = { x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) };
    out.push({ a: prev, b: cur });
    prev = cur;
  }
}

/**
 * 엔티티를 직선 세그먼트열로 분해. bulge 세그먼트·arc·circle 은 원호 근사한다.
 * text·dimension 은 측정 기준선이 아니므로 교차 대상에서 제외한다.
 */
export function segmentsOf(e: NEntity, out: Seg[]): void {
  switch (e.kind) {
    case 'line':
      out.push({ a: e.a, b: e.b });
      break;
    case 'polyline': {
      const n = e.vertices.length;
      const segCount = e.closed ? n : n - 1;
      for (let i = 0; i < segCount; i++) {
        const v0 = e.vertices[i];
        const v1 = e.vertices[(i + 1) % n];
        if (v0 === undefined || v1 === undefined) continue;
        if (v0.bulge === 0) {
          out.push({ a: v0.p, b: v1.p });
        } else {
          pushBulge(v0.p, v1.p, v0.bulge, out);
        }
      }
      break;
    }
    case 'arc':
      // NArc.a0→a1 은 CCW 규약 (schema)
      tessellateArc(e.center, e.r, e.a0, e.a1, true, out);
      break;
    case 'circle':
      tessellateArc(e.center, e.r, 0, 0, true, out);
      break;
    case 'hatch':
      for (const loop of e.loops) {
        const vs = loop.vertices;
        const m = vs.length;
        for (let i = 0; i < m; i++) {
          const v0 = vs[i];
          const v1 = vs[(i + 1) % m];
          if (v0 === undefined || v1 === undefined) continue;
          if (v0.bulge === 0) out.push({ a: v0.p, b: v1.p });
          else pushBulge(v0.p, v1.p, v0.bulge, out);
        }
      }
      break;
    default:
      // text·dimension: 교차 스냅 대상 아님
      break;
  }
}

/** bulge 세그먼트를 원호 근사해 push (bulgeToArc 실패 시 직선 폴백) */
function pushBulge(a: Vec2, b: Vec2, bulge: number, out: Seg[]): void {
  try {
    const arc = bulgeToArc(a, b, bulge);
    tessellateArc(arc.center, arc.r, arc.a0, arc.a1, arc.ccw, out);
  } catch {
    out.push({ a, b });
  }
}

/**
 * 두 **선분** 의 교점 — 교차하면 교점 Vec2, 아니면 null (순수).
 *
 * 파라메트릭: p = a1 + t·(b1−a1), q = a2 + u·(b2−a2). t,u ∈ [0,1] 이면 선분 내 교차.
 * - 평행(분모≈0): null (겹치는 공선 세그먼트는 유일 교점이 아니므로 스냅 대상에서 제외)
 * - 끝점 공유도 t/u ∈ [0,1] 이면 교점으로 반환(끝점=교점). 우선순위는 호출부가 endpoint를 위로 둔다.
 */
export function segmentIntersection(s1: Seg, s2: Seg): Vec2 | null {
  const r_x = s1.b.x - s1.a.x;
  const r_y = s1.b.y - s1.a.y;
  const s_x = s2.b.x - s2.a.x;
  const s_y = s2.b.y - s2.a.y;
  const denom = r_x * s_y - r_y * s_x;
  if (denom === 0) return null; // 평행 또는 공선
  const qp_x = s2.a.x - s1.a.x;
  const qp_y = s2.a.y - s1.a.y;
  const t = (qp_x * s_y - qp_y * s_x) / denom;
  const u = (qp_x * r_y - qp_y * r_x) / denom;
  // 부동소수 여유(선분 근사 원호가 살짝 벗어난 끝점 케이스 흡수)
  const EPS = 1e-9;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: s1.a.x + t * r_x, y: s1.a.y + t * r_y };
}

/**
 * 세그먼트 목록에서 서로 **다른 엔티티** 사이의 교점을 모아 반환 (순수).
 *
 * @param groups 엔티티별 세그먼트 그룹(같은 엔티티 내 세그먼트끼리는 교차시키지 않음 —
 *   폴리라인 인접변의 정점 공유가 교점으로 잡히는 것을 막는다).
 * @param near   커서 근방 필터 중심 (world). 이 점에서 within 이내의 교점만 수집(성능·정확도).
 * @param within near 로부터 허용 반경(도면 단위). 세그먼트 사전 필터·교점 후보 필터 공용.
 */
export function collectIntersections(
  groups: readonly (readonly Seg[])[],
  near: Vec2,
  within: number,
): Vec2[] {
  // 1) near 근방 세그먼트만 그룹별로 추린다(AABB + within 여유).
  const kept: Seg[][] = [];
  for (const g of groups) {
    const local: Seg[] = [];
    for (const seg of g) {
      if (segNearPoint(seg, near, within)) local.push(seg);
    }
    if (local.length > 0) kept.push(local);
  }
  // 2) 서로 다른 그룹 쌍의 세그먼트를 교차. 같은 그룹 내부는 건너뛴다.
  const pts: Vec2[] = [];
  for (let gi = 0; gi < kept.length; gi++) {
    const gA = kept[gi];
    if (gA === undefined) continue;
    for (let gj = gi + 1; gj < kept.length; gj++) {
      const gB = kept[gj];
      if (gB === undefined) continue;
      for (const sa of gA) {
        for (const sb of gB) {
          const p = segmentIntersection(sa, sb);
          if (p === null) continue;
          if (Math.hypot(p.x - near.x, p.y - near.y) > within) continue;
          if (!containsPoint(pts, p)) pts.push(p);
        }
      }
    }
  }
  return pts;
}

/** 세그먼트 AABB 가 near±within 박스와 겹치는가 (근방 사전 필터) */
function segNearPoint(seg: Seg, near: Vec2, within: number): boolean {
  const minX = Math.min(seg.a.x, seg.b.x) - within;
  const maxX = Math.max(seg.a.x, seg.b.x) + within;
  const minY = Math.min(seg.a.y, seg.b.y) - within;
  const maxY = Math.max(seg.a.y, seg.b.y) + within;
  return near.x >= minX && near.x <= maxX && near.y >= minY && near.y <= maxY;
}

/** 이미 수집된 점과 사실상 동일한 교점인지 (중복 제거) */
function containsPoint(pts: readonly Vec2[], p: Vec2): boolean {
  for (const q of pts) {
    const scale = 1 + Math.max(Math.abs(q.x), Math.abs(q.y));
    if (
      Math.abs(q.x - p.x) <= SAME_POINT_EPS * scale &&
      Math.abs(q.y - p.y) <= SAME_POINT_EPS * scale
    )
      return true;
  }
  return false;
}
