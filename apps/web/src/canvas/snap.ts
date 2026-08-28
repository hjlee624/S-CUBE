/**
 * 스냅 엔진 (P1-10 필수) — 커서 주변 엔티티의 끝점/중점/중심에 흡착.
 * R-tree로 후보 엔티티를 좁힌 뒤 화면 px 거리로 최근접 점을 고른다.
 */
import type { NEntity, Vec2 } from '@s-cube/schema';
import { scene } from './scene.ts';
import type { Viewport } from './transform.ts';

export type SnapKind = 'endpoint' | 'midpoint' | 'center';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** 근거 엔티티 handle (추적용) */
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

/** 엔티티별 스냅 후보 생성 */
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
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined) continue;
    candidatesOf(e, candidates);
  }
  let best: Candidate | null = null;
  let bestDist = r_world;
  for (const c of candidates) {
    const d = Math.hypot(c.point.x - cursorWorld.x, c.point.y - cursorWorld.y);
    // 동거리면 endpoint > midpoint > center 우선
    if (d < bestDist || (best !== null && d === bestDist && rank(c.kind) < rank(best.kind))) {
      best = c;
      bestDist = d;
    }
  }
  return best === null ? null : { point: best.point, kind: best.kind, handle: best.handle };
}

function rank(kind: SnapKind): number {
  if (kind === 'endpoint') return 0;
  if (kind === 'midpoint') return 1;
  return 2;
}
