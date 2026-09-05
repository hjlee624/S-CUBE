/**
 * RW-28: 평면 폐합면 열거 — 스냅 그래프에서 유계면(bounded face)을 모두 추적한다.
 *
 * 하프에지 면추적(O(E)): 각 방향 하프에지를 각도 규칙("도착 노드에서 들어온 방향의 바로 이전
 * 시계방향 간선")으로 한 번씩 따라가 면을 만든다. findClosedFaces(모든 단순순환 열거)와 달리
 * 교차 밀집 그래프에서도 폭발하지 않는다.
 *
 * 용도:
 * - boundaryAtPoint: 점을 포함하는 최소 면(단일 픽).
 * - facesInRegion: 사각형 범위 안의 모든 폐합면(범위 선택 → 다중 픽).
 */
import { buildSnapGraph, type SnapEdge, type SnapNode } from './auto-close.ts';
import { pointInPolygon } from './area.ts';
import { splitAtIntersections } from './intersect-split.ts';
import type { NEntity, Vec2 } from '@s-cube/schema';

/** 추적된 폐합면 */
export interface TracedFace {
  vertices: Vec2[];
  /** 절대 면적 (도면 단위²) */
  areaRaw: number;
  /** 경계를 이루는 엔티티 handle 목록(역추적) */
  handles: string[];
}

/** 축 정렬 사각형 */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function centroid(pts: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length || 1;
  return { x: x / n, y: y / n };
}

interface AdjEntry {
  to: number;
  angle: number;
  handle: string;
}

const FACE_KEY_SCALE = 1_000_003;

/**
 * 스냅 그래프의 모든 유계면을 하프에지 추적으로 열거한다(O(E)). 외곽 무한면 포함 가능하나
 * 호출측이 면적 상한(maxArea)으로 걸러낸다.
 */
export function enumerateFaces(nodes: readonly SnapNode[], edges: readonly SnapEdge[]): TracedFace[] {
  if (edges.length < 3) return [];
  const adj = new Map<number, AdjEntry[]>();
  const push = (from: number, to: number, handle: string): void => {
    const nf = nodes[from];
    const nt = nodes[to];
    if (nf === undefined || nt === undefined) return;
    const angle = Math.atan2(nt.pos.y - nf.pos.y, nt.pos.x - nf.pos.x);
    const list = adj.get(from);
    if (list === undefined) adj.set(from, [{ to, angle, handle }]);
    else list.push({ to, angle, handle });
  };
  for (const e of edges) {
    push(e.from, e.to, e.handle);
    push(e.to, e.from, e.handle);
  }
  for (const list of adj.values()) list.sort((a, b) => a.angle - b.angle);

  const visited = new Set<number>();
  const key = (u: number, v: number): number => u * FACE_KEY_SCALE + v;
  const faces: TracedFace[] = [];

  for (const e of edges) {
    for (const [su, sv] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      if (visited.has(key(su, sv))) continue;
      const vertsIdx: number[] = [];
      const handles: string[] = [];
      let cu = su;
      let cv = sv;
      let guard = 0;
      let ok = true;
      do {
        visited.add(key(cu, cv));
        vertsIdx.push(cu);
        const listCu = adj.get(cu);
        const eh = listCu?.find((x) => x.to === cv);
        if (eh !== undefined) handles.push(eh.handle);
        const listCv = adj.get(cv);
        if (listCv === undefined || listCv.length === 0) {
          ok = false;
          break;
        }
        const idx = listCv.findIndex((x) => x.to === cu);
        if (idx === -1) {
          ok = false;
          break;
        }
        const next = listCv[(idx - 1 + listCv.length) % listCv.length];
        if (next === undefined) {
          ok = false;
          break;
        }
        cu = cv;
        cv = next.to;
      } while (!(cu === su && cv === sv) && guard++ < 200_000);

      if (!ok || vertsIdx.length < 3) continue;
      const verts = vertsIdx.map((i) => nodes[i]?.pos ?? { x: 0, y: 0 });
      const area = Math.abs(signedArea(verts));
      if (area <= 1e-9) continue;
      faces.push({ vertices: verts, areaRaw: area, handles: [...new Set(handles)] });
    }
  }
  return faces;
}

/** 세그먼트 상한 — 넘으면 성능 위험이라 null 신호(호출측이 창 축소·안내) */
export const MAX_REGION_SEGMENTS = 2500;

/**
 * 사각형 범위 안의 모든 폐합면을 탐지한다 (RW-28, 범위 선택 → 다중 픽).
 *
 * @param segments  범위와 겹치는 line/polyline (호출측 windowing)
 * @param rect      선택 사각형(도면 좌표)
 * @param snapTolerance 끝점 병합 거리
 * @param maxArea   이보다 큰 면 제외(도곽/외곽 배제)
 * @returns 면적 오름차순 폐합면 목록. 세그먼트 과다면 null.
 */
export function facesInRegion(
  segments: readonly NEntity[],
  rect: Rect,
  snapTolerance: number,
  maxArea: number,
): TracedFace[] | null {
  const split = splitAtIntersections(segments);
  if (split.length > MAX_REGION_SEGMENTS) return null;
  const { nodes, edges } = buildSnapGraph(split, snapTolerance);
  const faces = enumerateFaces(nodes, edges);
  const inRect = (p: Vec2): boolean =>
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
  // 중심이 사각형 안이고, 면적이 (0, maxArea] 인 면만. 중복(같은 정점집합) 제거.
  const seen = new Set<string>();
  const out: TracedFace[] = [];
  for (const f of faces) {
    if (f.areaRaw <= 1e-9 || f.areaRaw > maxArea) continue;
    if (!inRect(centroid(f.vertices))) continue;
    const sig = `${Math.round(f.areaRaw * 100)}:${f.vertices.length}`;
    // 정점 수+면적 근사 시그니처로 완전 중복만 거른다(같은 면 두 방향 추적).
    const cx = Math.round(centroid(f.vertices).x * 10);
    const cy = Math.round(centroid(f.vertices).y * 10);
    const fullSig = `${sig}:${cx}:${cy}`;
    if (seen.has(fullSig)) continue;
    seen.add(fullSig);
    out.push(f);
  }
  return out.sort((a, b) => a.areaRaw - b.areaRaw);
}

/** 점을 포함하는 최소 유계면 (단일 픽) — enumerateFaces 재사용. */
export function faceContainingPoint(
  nodes: readonly SnapNode[],
  edges: readonly SnapEdge[],
  point: Vec2,
  maxArea: number,
): TracedFace | null {
  const faces = enumerateFaces(nodes, edges).sort((a, b) => a.areaRaw - b.areaRaw);
  for (const f of faces) {
    if (f.areaRaw <= 1e-9 || f.areaRaw > maxArea) continue;
    if (pointInPolygon(point, f.vertices.map((p) => ({ p, bulge: 0 })))) return f;
  }
  return null;
}
