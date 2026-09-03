/**
 * RW-11: 자동 폐합 탐색 — 열린 선분 그래프에서 닫힌 면(face)을 탐색한다.
 *
 * 알고리즘:
 * 1. 선분 끝점을 snap tolerance로 병합해 위상 노드를 만든다(Union-Find + 격자 인덱스).
 * 2. 노드-간선 위상 그래프를 구성한다.
 * 3. 각 노드에서 DFS로 최소 순환(cycle)을 탐색한다.
 * 4. 폴리곤 면적 > 0 인 순환만 폐합 후보로 반환한다.
 *
 * 한계(v1):
 * - LINE/POLYLINE만 지원. ARC는 단순 선분 근사.
 * - snap tolerance 초과 간격은 자동 연결하지 않는다.
 * - 복잡한 자기교차 도형에서 최소 face 보장 안 됨.
 */
import { polygonArea } from './area.ts';
import type { NEntity, Vec2 } from '@s-cube/schema';

export interface SnapNode {
  id: number;
  pos: Vec2;
  /** 이 노드를 공유하는 엔티티 핸들 목록 */
  handles: string[];
}

export interface SnapEdge {
  id: number;
  from: number; // SnapNode.id
  to: number;   // SnapNode.id
  handle: string;
}

export interface SnapGraph {
  nodes: SnapNode[];
  edges: SnapEdge[];
}

/** 탐색된 폐합 후보 */
export interface ClosedFace {
  /** 폐합 폴리라인 정점열 (world 좌표, 도면 단위) */
  vertices: Vec2[];
  /** 면적 (㎡ 아님 — 도면 단위²) */
  areaRaw: number;
  /** 경계를 이루는 엔티티 핸들 목록 */
  handles: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Snap 그래프 구성
// ─────────────────────────────────────────────────────────────────────────────

/** Union-Find (path compression + union by rank) */
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x] as number);
    return this.parent[x] as number;
  }

  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;
    if ((this.rank[px] as number) < (this.rank[py] as number)) {
      this.parent[px] = py;
    } else if ((this.rank[px] as number) > (this.rank[py] as number)) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      (this.rank[px] as number)++;
    }
  }
}

/** 격자 셀 키 — snap tolerance 단위로 정규화 */
function gridKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

/**
 * NEntity 배열에서 선분 끝점을 추출하고 snap tolerance로 병합해 위상 그래프를 만든다.
 * LINE, POLYLINE, LWPOLYLINE 만 지원한다.
 */
export function buildSnapGraph(entities: readonly NEntity[], snapTolerance: number): SnapGraph {
  if (!(snapTolerance > 0)) snapTolerance = 1e-6;

  // 끝점 목록: {pt, handle}
  const rawPts: { pt: Vec2; handle: string }[] = [];
  for (const e of entities) {
    if (e.kind === 'line') {
      rawPts.push({ pt: e.a, handle: e.handle });
      rawPts.push({ pt: e.b, handle: e.handle });
    } else if (e.kind === 'polyline') {
      if (e.vertices.length < 2) continue;
      for (const v of e.vertices) rawPts.push({ pt: v.p, handle: e.handle });
      if (e.closed && e.vertices.length >= 2) {
        // 폐합 폴리라인은 첫·끝 끝점을 추가로 등록 (snap 연결을 위해)
        const first = e.vertices[0];
        const last = e.vertices[e.vertices.length - 1];
        if (first !== undefined) rawPts.push({ pt: first.p, handle: e.handle });
        if (last !== undefined) rawPts.push({ pt: last.p, handle: e.handle });
      }
    }
  }

  const n = rawPts.length;
  const uf = new UnionFind(n);

  // 격자 기반 근접 그룹핑 — O(n) 평균
  const grid = new Map<string, number[]>();
  const cellSize = snapTolerance;
  for (let i = 0; i < n; i++) {
    const pt = rawPts[i];
    if (pt === undefined) continue;
    const key = gridKey(pt.pt.x, pt.pt.y, cellSize);
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [i]);
    else list.push(i);
  }

  // 인접 9개 셀 검사로 snap 병합
  for (let i = 0; i < n; i++) {
    const pt = rawPts[i];
    if (pt === undefined) continue;
    const cx = Math.floor(pt.pt.x / cellSize);
    const cy = Math.floor(pt.pt.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(`${cx + dx},${cy + dy}`);
        if (neighbors === undefined) continue;
        for (const j of neighbors) {
          if (j <= i) continue;
          const pj = rawPts[j];
          if (pj === undefined) continue;
          const dist = Math.hypot(pt.pt.x - pj.pt.x, pt.pt.y - pj.pt.y);
          if (dist <= snapTolerance) uf.union(i, j);
        }
      }
    }
  }

  // 대표 ID별 노드 구성
  const repToNode = new Map<number, number>(); // rep → nodeId
  const nodes: SnapNode[] = [];
  // 대표별 포지션·핸들 누적
  const repPos = new Map<number, Vec2>();
  const repHandles = new Map<number, Set<string>>();
  for (let i = 0; i < n; i++) {
    const pt = rawPts[i];
    if (pt === undefined) continue;
    const rep = uf.find(i);
    if (!repPos.has(rep)) repPos.set(rep, pt.pt);
    const hs = repHandles.get(rep);
    if (hs === undefined) repHandles.set(rep, new Set([pt.handle]));
    else hs.add(pt.handle);
  }
  for (const [rep, pos] of repPos) {
    const nodeId = nodes.length;
    repToNode.set(rep, nodeId);
    nodes.push({ id: nodeId, pos, handles: [...(repHandles.get(rep) ?? [])] });
  }

  // 간선 구성: 각 엔티티의 연속 끝점 쌍
  const edges: SnapEdge[] = [];
  const seenEdge = new Set<string>();
  let ptIdx = 0;
  for (const e of entities) {
    if (e.kind === 'line') {
      const fromRep = uf.find(ptIdx);
      const toRep = uf.find(ptIdx + 1);
      ptIdx += 2;
      const fromId = repToNode.get(fromRep);
      const toId = repToNode.get(toRep);
      if (fromId === undefined || toId === undefined || fromId === toId) continue;
      const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ id: edges.length, from: fromId, to: toId, handle: e.handle });
    } else if (e.kind === 'polyline') {
      if (e.vertices.length < 2) { ptIdx += e.vertices.length; continue; }
      const vCount = e.vertices.length;
      const startPtIdx = ptIdx;
      ptIdx += vCount;
      // closed polyline: extra 2 ptIdx entries added above
      if (e.closed) ptIdx += 2;
      for (let vi = 0; vi < vCount - 1; vi++) {
        const fromRep = uf.find(startPtIdx + vi);
        const toRep = uf.find(startPtIdx + vi + 1);
        const fromId = repToNode.get(fromRep);
        const toId = repToNode.get(toRep);
        if (fromId === undefined || toId === undefined || fromId === toId) continue;
        const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push({ id: edges.length, from: fromId, to: toId, handle: e.handle });
      }
      if (e.closed) {
        // 마지막↔첫 정점 연결
        const fromRep = uf.find(startPtIdx + vCount - 1);
        const toRep = uf.find(startPtIdx);
        const fromId = repToNode.get(fromRep);
        const toId = repToNode.get(toRep);
        if (fromId !== undefined && toId !== undefined && fromId !== toId) {
          const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
          if (!seenEdge.has(key)) {
            seenEdge.add(key);
            edges.push({ id: edges.length, from: fromId, to: toId, handle: e.handle });
          }
        }
      }
    }
  }

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 최소 순환(cycle) 탐색 → 폐합 후보
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CYCLE_LENGTH = 32; // 순환 탐색 최대 깊이 (과도한 순환 방지)

/**
 * 위상 그래프에서 단순 순환(simple cycle)을 탐색해 면적 > 0 인 것을 반환한다.
 *
 * DFS 기반 순환 탐색: 각 시작 노드에서 깊이 우선으로 이웃을 방문하고,
 * 시작 노드로 돌아오면 순환 확정. 중복 제거: 정점 ID 최솟값이 시작인 순환만 보관.
 */
export function findClosedFaces(graph: SnapGraph): ClosedFace[] {
  const { nodes, edges } = graph;
  if (nodes.length < 3 || edges.length < 3) return [];

  // 인접 목록 구성
  const adj = new Map<number, { to: number; edgeId: number }[]>();
  for (const e of edges) {
    const fa = adj.get(e.from) ?? [];
    fa.push({ to: e.to, edgeId: e.id });
    adj.set(e.from, fa);
    const ta = adj.get(e.to) ?? [];
    ta.push({ to: e.from, edgeId: e.id });
    adj.set(e.to, ta);
  }

  const faces: ClosedFace[] = [];
  const seenCycle = new Set<string>();

  /** DFS로 startId에서 시작해 길이 ≤ MAX_CYCLE_LENGTH 인 순환을 탐색 */
  function dfs(
    current: number,
    startId: number,
    path: number[],
    usedEdges: Set<number>,
    edgeHandles: string[],
  ): void {
    if (path.length > MAX_CYCLE_LENGTH) return;
    const neighbors = adj.get(current) ?? [];
    for (const { to, edgeId } of neighbors) {
      if (usedEdges.has(edgeId)) continue;
      if (to === startId && path.length >= 3) {
        // 순환 발견 — 최솟값 노드가 startId 이어야 중복 제거
        const minNode = Math.min(...path);
        if (minNode !== startId) continue;
        // 정규화 키 (회전 불변 + 반전 불변)
        const sorted = [...path].sort((a, b) => a - b);
        const key = sorted.join(',');
        if (seenCycle.has(key)) continue;
        seenCycle.add(key);
        // 정점 좌표 + 면적 계산
        const verts = path.map((id) => nodes[id]?.pos ?? { x: 0, y: 0 });
        const area = polygonArea(verts.map((v) => ({ p: v, bulge: 0 })), true);
        if (area <= 0) continue;
        const closingHandle = edges[edgeId]?.handle ?? '';
        const allHandles = [...new Set([...edgeHandles, closingHandle])];
        faces.push({ vertices: verts, areaRaw: area, handles: allHandles });
        continue;
      }
      // 시작점이 아닌 방문한 노드는 건너뜀 (단순 순환)
      if (path.includes(to)) continue;
      // 시작점보다 작은 ID 방향은 탐색 안 함 (중복 제거)
      if (to < startId) continue;
      usedEdges.add(edgeId);
      path.push(to);
      edgeHandles.push(edges[edgeId]?.handle ?? '');
      dfs(to, startId, path, usedEdges, edgeHandles);
      path.pop();
      edgeHandles.pop();
      usedEdges.delete(edgeId);
    }
  }

  for (const node of nodes) {
    dfs(node.id, node.id, [node.id], new Set(), []);
  }

  // 면적 오름차순 정렬 (작은 face 우선)
  return faces.sort((a, b) => a.areaRaw - b.areaRaw);
}

/**
 * 통합 API — NEntity 배열에서 자동 폐합 후보를 반환한다 (RW-11).
 *
 * @param entities 도면 엔티티 목록
 * @param snapTolerance 끝점 병합 거리 (도면 단위)
 * @returns 폐합 후보 목록 (면적 오름차순)
 */
export function autoCloseEntities(
  entities: readonly NEntity[],
  snapTolerance: number,
): ClosedFace[] {
  const graph = buildSnapGraph(entities, snapTolerance);
  return findClosedFaces(graph);
}
