/**
 * RW-25/26: 점 지정 경계 탐색 — 클릭한 점을 감싸는 **최소 폐합 면**을 찾는다(AutoCAD BOUNDARY/
 * 해치 픽포인트와 동일). 절토/성토처럼 "닫힌 단일 객체가 아니라 여러 선(원지반선·계획선)이
 * 교차하며 둘러싼 영역"의 면적을 점 하나로 취득한다.
 *
 * 알고리즘(평면 하프에지 면추적, O(E)):
 * 1. splitAtIntersections — 교차하는 선들을 교차점에서 분할(교차점을 공유 끝점으로).
 * 2. buildSnapGraph — 끝점 snap 으로 위상 그래프(노드·간선) 구성.
 * 3. 각 노드에서 간선을 각도로 정렬 → 방향 하프에지의 "다음 간선"을 각도 규칙으로 정해 면을
 *    한 번씩 추적(각 하프에지 1회 방문 → 총 O(E)). findClosedFaces(모든 단순순환 열거)와 달리
 *    밀도 높은 교차 그래프에서도 폭발하지 않는다.
 * 4. 점을 포함하는(pointInPolygon) 유계면 중 면적이 최소이고 maxArea 이하인 것을 반환.
 */
import { pointInPolygon } from './area.ts';
import { buildSnapGraph } from './auto-close.ts';
import { splitAtIntersections } from './intersect-split.ts';
import type { NEntity, Vec2 } from '@s-cube/schema';

/** 점을 감싸는 폐합 영역 */
export interface BoundaryFace {
  vertices: Vec2[];
  areaRaw: number;
  handles: string[];
}

/** 간선 수 안전 상한 — 하프에지 추적은 O(E)라 여유롭게 잡되 병리적 밀도는 차단 */
const MAX_EDGES = 6000;

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

interface AdjEntry {
  to: number;
  angle: number;
  handle: string;
}

/**
 * 점을 감싸는 최소 유계면을 찾는다. 없으면 null.
 *
 * @param segments  클릭 주변 창으로 제한된 엔티티(호출측 windowing 필수)
 * @param point     클릭 지점(도면 좌표)
 * @param snapTolerance  끝점 병합 거리(도면 단위)
 * @param maxArea   이보다 큰 면은 무시(도면 외곽 프레임 배제용). 기본 무제한.
 */
export function boundaryAtPoint(
  segments: readonly NEntity[],
  point: Vec2,
  snapTolerance: number,
  maxArea = Number.POSITIVE_INFINITY,
): BoundaryFace | null {
  const split = splitAtIntersections(segments);
  const { nodes, edges } = buildSnapGraph(split, snapTolerance);
  if (edges.length < 3 || edges.length > MAX_EDGES) return null;

  // 각 노드의 인접 간선(각도·handle) 목록 — 각도 오름차순 정렬.
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

  // 방향 하프에지(from->to)를 각 1회 추적해 면을 만든다.
  const visited = new Set<number>();
  const key = (u: number, v: number): number => u * 1_000_003 + v;

  let best: { vertices: Vec2[]; areaRaw: number; handles: string[] } | null = null;
  let bestArea = maxArea;

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
      // 면 한 바퀴: 시작 하프에지로 되돌아올 때까지.
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
        // 도착 노드 cv 에서, 들어온 방향(cv->cu)의 바로 이전(시계방향) 간선을 다음으로.
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
      } while (!(cu === su && cv === sv) && guard++ < 100_000);

      if (!ok || vertsIdx.length < 3) continue;
      const verts = vertsIdx.map((i) => nodes[i]?.pos ?? { x: 0, y: 0 });
      const area = Math.abs(signedArea(verts));
      if (area <= 1e-9 || area >= bestArea) continue;
      if (pointInPolygon(point, verts.map((p) => ({ p, bulge: 0 })))) {
        best = { vertices: verts, areaRaw: area, handles: [...new Set(handles)] };
        bestArea = area;
      }
    }
  }

  return best;
}
