/**
 * 폴리라인 유효성 술어 — 자기교차(self-intersection) 검사.
 *
 * bulge 는 직선 근사(현)로 간주한 보수적 검사다. 면적 0 판정은 호출측에서
 * |polygonArea| < ε 로 처리한다(core 는 술어만 제공, 21-CONVENTIONS §4).
 */
import type { PVertex, Vec2 } from '@s-cube/schema';

/** O(n²) 전수 검사를 허용하는 정점 수 상한. 초과 시 검사를 건너뛰고 false 반환. */
const MAX_SELF_INTERSECT_VERTICES = 2000;

/** 방향 판정(cross product 부호): >0 CCW, <0 CW, 0 공선. */
function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 점 c 가 세그먼트 a-b(공선 가정) 위에 있는가. */
function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

/** 두 선분 p1-p2, p3-p4 가 (proper 또는 공선 겹침으로) 교차하는가. */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);
  // 일반 교차 — 서로 반대편에 있음
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // 공선 겹침 케이스
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/**
 * 폴리라인이 자기교차하는가 — 폐합 폴리곤(마지막→첫 정점)으로 간주해 세그먼트 쌍을 검사.
 * bulge 는 현(직선)으로 근사한다(보수적). 인접 세그먼트(끝점 공유)와
 * 첫-마지막 인접쌍은 교차로 세지 않는다. O(n²), 정점 상한 초과 시 false.
 *
 * - 나비형(bowtie) → true
 * - 볼록/오목 단순 다각형 → false
 */
export function isSelfIntersecting(vertices: PVertex[]): boolean {
  const pts = vertices.map((v) => v.p);
  const n = pts.length;
  if (n < 4) return false; // 삼각형 이하는 자기교차 불가
  if (n > MAX_SELF_INTERSECT_VERTICES) return false; // 상한 초과 — 검사 생략
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    if (a1 === undefined || a2 === undefined) continue;
    for (let j = i + 1; j < n; j++) {
      // 인접 세그먼트(끝점 공유)는 건너뛴다
      if (j === i) continue;
      if ((j + 1) % n === i) continue; // j 세그먼트가 i 세그먼트 바로 앞
      if (i + 1 === j) continue; // 바로 뒤 인접
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (b1 === undefined || b2 === undefined) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
