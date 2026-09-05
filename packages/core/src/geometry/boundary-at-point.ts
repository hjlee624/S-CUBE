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
import { buildSnapGraph } from './auto-close.ts';
import { splitAtIntersections } from './intersect-split.ts';
import { faceContainingPoint } from './planar-faces.ts';
import type { NEntity, Vec2 } from '@s-cube/schema';

/** 점을 감싸는 폐합 영역 */
export interface BoundaryFace {
  vertices: Vec2[];
  areaRaw: number;
  handles: string[];
}

/** 간선 수 안전 상한 — 하프에지 추적은 O(E)라 여유롭게 잡되 병리적 밀도는 차단 */
const MAX_EDGES = 6000;

/**
 * 점을 감싸는 최소 유계면을 찾는다. 없으면 null. (planar-faces 의 하프에지 면추적 재사용)
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
  return faceContainingPoint(nodes, edges, point, maxArea);
}
