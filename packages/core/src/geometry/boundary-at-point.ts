/**
 * RW-25: 점 지정 경계 탐색 — 클릭한 점을 감싸는 최소 폐합 영역을 찾는다(AutoCAD BOUNDARY/
 * 해치 픽포인트와 동일 개념). 절토/성토처럼 "닫힌 단일 객체가 아니라 여러 선으로 둘러싸인
 * 영역"의 면적을 점 하나로 취득하기 위한 함수.
 *
 * 성능: findClosedFaces 의 순환 열거는 전역 그래프에서 폭발한다(수백 선분이면 hang). 그래서
 * **호출측이 클릭 주변 창으로 세그먼트를 제한(windowing + cap)** 해 넘겨야 한다 — 국소 부분
 * 그래프(수십 edge)에서는 1ms 내로 끝난다. 이 함수는 방어적으로 edge 상한도 둔다.
 */
import { buildSnapGraph, findClosedFaces } from './auto-close.ts';
import { pointInPolygon } from './area.ts';
import type { NEntity, Vec2 } from '@s-cube/schema';

/** 점을 감싸는 폐합 영역 */
export interface BoundaryFace {
  /** 경계 정점열 (world 좌표, 도면 단위) */
  vertices: Vec2[];
  /** 면적 (도면 단위²) */
  areaRaw: number;
  /** 경계를 이루는 엔티티 handle 목록 (역추적) */
  handles: string[];
}

/** 부분 그래프 edge 상한 — 이보다 조밀하면 순환 탐색이 위험하므로 포기(null). */
const MAX_EDGES = 260;

/**
 * segments(클릭 주변으로 이미 제한된 line/polyline) 에서 point 를 감싸는 **최소** 폐합 영역을
 * 찾는다. 없으면 null.
 *
 * @param segments  클릭 주변 창으로 제한된 엔티티(호출측 windowing 필수)
 * @param point     클릭 지점(도면 좌표)
 * @param snapTolerance  끝점 병합 거리(도면 단위)
 * @param maxArea   이보다 큰 face 는 무시(도면 외곽 프레임 배제용). 기본 무제한.
 */
export function boundaryAtPoint(
  segments: readonly NEntity[],
  point: Vec2,
  snapTolerance: number,
  maxArea = Number.POSITIVE_INFINITY,
): BoundaryFace | null {
  const graph = buildSnapGraph(segments, snapTolerance);
  if (graph.edges.length === 0 || graph.edges.length > MAX_EDGES) return null;
  // findClosedFaces 는 면적 오름차순 정렬 → 점을 포함하는 첫 face(단, maxArea 이하)가
  // 최소 폐합 영역. 도면 외곽 프레임(거대 폐합)은 maxArea 초과로 건너뛴다.
  const faces = findClosedFaces(graph);
  for (const f of faces) {
    if (f.areaRaw <= 0 || f.areaRaw > maxArea) continue;
    if (pointInPolygon(point, f.vertices.map((p) => ({ p, bulge: 0 })))) {
      return { vertices: f.vertices, areaRaw: f.areaRaw, handles: f.handles };
    }
  }
  return null;
}
