/**
 * 스냅 엔진 (P1-10 필수) — 커서 주변 엔티티의 끝점/교차점/중점/중심에 흡착.
 * R-tree로 후보 엔티티를 좁힌 뒤 화면 px 거리로 최근접 점을 고른다.
 *
 * 우선순위: endpoint > intersection > midpoint > center (RW-3).
 * 커서 반경 내 여러 후보는 (우선순위, 거리) 사전식으로 고른다 — 가장 우선인 종류 중 최근접.
 */
import type { NEntity, Vec2 } from '@s-cube/schema';
import { collectIntersections, type Seg, segmentsOf } from './intersection.ts';
import { scene } from './scene.ts';
import type { Viewport } from './transform.ts';

export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'center';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** 근거 엔티티 handle (추적용). 교차점은 두 엔티티 접점이라 대표(첫) handle 을 담거나 빈 문자열 */
  handle: string;
}

interface Candidate {
  point: Vec2;
  kind: SnapKind;
  handle: string;
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 엔티티별 정점/중점/중심 스냅 후보 생성 (교차점 제외 — 교차점은 별도 경로) */
function candidatesOf(e: NEntity, out: Candidate[]): void {
  switch (e.kind) {
    case 'line':
      out.push({ point: e.a, kind: 'endpoint', handle: e.handle });
      out.push({ point: e.b, kind: 'endpoint', handle: e.handle });
      out.push({ point: mid(e.a, e.b), kind: 'midpoint', handle: e.handle });
      break;
    case 'polyline': {
      for (let i = 0; i < e.vertices.length; i++) {
        const v = e.vertices[i];
        if (v === undefined) continue;
        out.push({ point: v.p, kind: 'endpoint', handle: e.handle });
        // 직선 세그먼트 중점 (bulge 세그먼트는 원호라 정점만)
        const next = e.vertices[i + 1] ?? (e.closed ? e.vertices[0] : undefined);
        if (next !== undefined && v.bulge === 0 && !(i === e.vertices.length - 1 && !e.closed)) {
          out.push({ point: mid(v.p, next.p), kind: 'midpoint', handle: e.handle });
        }
      }
      break;
    }
    case 'arc': {
      out.push({ point: e.center, kind: 'center', handle: e.handle });
      out.push({
        point: { x: e.center.x + e.r * Math.cos(e.a0), y: e.center.y + e.r * Math.sin(e.a0) },
        kind: 'endpoint',
        handle: e.handle,
      });
      out.push({
        point: { x: e.center.x + e.r * Math.cos(e.a1), y: e.center.y + e.r * Math.sin(e.a1) },
        kind: 'endpoint',
        handle: e.handle,
      });
      break;
    }
    case 'circle':
      out.push({ point: e.center, kind: 'center', handle: e.handle });
      break;
    case 'dimension':
      for (const p of e.defPoints) out.push({ point: p, kind: 'endpoint', handle: e.handle });
      break;
    case 'hatch':
      for (const loop of e.loops) {
        for (const v of loop.vertices) out.push({ point: v.p, kind: 'endpoint', handle: e.handle });
      }
      break;
    case 'text':
      // 텍스트 삽입점은 측정 기준으로 부적합 — 스냅 제외
      break;
  }
}

/** 스냅 종류 우선순위 — 작을수록 우선. endpoint > intersection > midpoint > center */
export function rank(kind: SnapKind): number {
  switch (kind) {
    case 'endpoint':
      return 0;
    case 'intersection':
      return 1;
    case 'midpoint':
      return 2;
    default:
      return 3; // center
  }
}

/**
 * 후보들 중 최적 하나 선택 (순수). 반경 r_world 이내 후보만 대상으로,
 * (우선순위 rank, 커서까지 거리) 사전식 비교 — 더 우선인 종류가 항상 이기고,
 * 같은 종류면 더 가까운 것이 이긴다.
 */
export function pickBestCandidate(
  candidates: readonly Candidate[],
  cursor: Vec2,
  r_world: number,
): SnapResult | null {
  let best: Candidate | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = Math.hypot(c.point.x - cursor.x, c.point.y - cursor.y);
    if (d > r_world) continue;
    const rk = rank(c.kind);
    if (rk < bestRank || (rk === bestRank && d < bestDist)) {
      best = c;
      bestRank = rk;
      bestDist = d;
    }
  }
  return best === null ? null : { point: best.point, kind: best.kind, handle: best.handle };
}

/**
 * cursorWorld 근처에서 스냅 점 탐색.
 * @param snapRadius_px 화면 px 기준 흡착 반경
 */
export function findSnap(
  cursorWorld: Vec2,
  vp: Viewport,
  snapRadius_px: number,
): SnapResult | null {
  const { model, index } = scene;
  if (model === null || index === null) return null;
  const r_world = snapRadius_px / vp.pxPerUnit;
  const hits = index.search({
    minX: cursorWorld.x - r_world,
    minY: cursorWorld.y - r_world,
    maxX: cursorWorld.x + r_world,
    maxY: cursorWorld.y + r_world,
  });
  const candidates: Candidate[] = [];
  // 교차점 계산용 — 엔티티별 세그먼트 그룹(같은 엔티티 내부는 교차 제외)
  const segGroups: Seg[][] = [];
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined) continue;
    candidatesOf(e, candidates);
    const segs: Seg[] = [];
    segmentsOf(e, segs);
    if (segs.length > 0) segGroups.push(segs);
  }
  // 커서 근방(반경 내) 세그먼트 쌍의 교점을 후보에 추가.
  const inters = collectIntersections(segGroups, cursorWorld, r_world);
  for (const p of inters) {
    candidates.push({ point: p, kind: 'intersection', handle: '' });
  }
  return pickBestCandidate(candidates, cursorWorld, r_world);
}
