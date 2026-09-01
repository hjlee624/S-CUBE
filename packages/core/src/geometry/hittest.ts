/**
 * 히트테스트 프리미티브 — 순수 기하 술어(거리 계산)만 제공한다.
 *
 * 실제 R-tree 후보 축소·픽킹·픽 tolerance(px)는 web 경계에서 처리하고,
 * core 는 도면 단위 거리 계산만 담당한다(21-CONVENTIONS §4). 반올림하지 않는다.
 */
import type { PVertex, Vec2 } from '@s-cube/schema';
import { bulgeToArc, distance } from './primitives.ts';

/**
 * 점 p 에서 선분 a-b 까지 최단 거리(도면 단위).
 * 투영 파라미터 t 를 [0,1] 로 clamp 해 끝점 밖은 끝점까지 거리로 처리한다.
 */
export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a); // 퇴화 세그먼트(길이 0)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj: Vec2 = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(p, proj);
}

/** 원호 세그먼트 근사 분할 수 — bulge 곡률이 클수록 촘촘히(최소 4, 최대 64). */
function arcSubdivisions(bulge: number): number {
  const sweep = 4 * Math.atan(Math.abs(bulge));
  const n = Math.ceil(sweep / (Math.PI / 15));
  return Math.min(64, Math.max(4, n));
}

/**
 * 점 p 에서 폴리라인까지 최단 세그먼트 거리(도면 단위).
 * bulge 원호 세그먼트는 여러 직선으로 근사 분할해 최소 거리를 취한다.
 * closed=true 이면 마지막→첫 정점 폐합 세그먼트도 포함한다.
 */
export function distancePointToPolyline(p: Vec2, vertices: PVertex[], closed: boolean): number {
  const n = vertices.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (n === 1) {
    const only = vertices[0];
    return only === undefined ? Number.POSITIVE_INFINITY : distance(p, only.p);
  }
  const segCount = closed ? n : n - 1;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (v0 === undefined || v1 === undefined) continue;
    if (v0.bulge !== 0 && distance(v0.p, v1.p) > 0) {
      // 원호 근사 — 시작점 + 보간 점들 + 끝점을 잇는 직선 세그먼트 거리의 최소
      const arc = bulgeToArc(v0.p, v1.p, v0.bulge);
      const steps = arcSubdivisions(v0.bulge);
      let sweep = arc.a1 - arc.a0;
      if (arc.ccw) {
        while (sweep <= 0) sweep += 2 * Math.PI;
      } else {
        while (sweep >= 0) sweep -= 2 * Math.PI;
      }
      let prev: Vec2 = v0.p;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const ang = arc.a0 + sweep * t;
        const cur: Vec2 =
          s === steps
            ? v1.p
            : { x: arc.center.x + arc.r * Math.cos(ang), y: arc.center.y + arc.r * Math.sin(ang) };
        const d = distancePointToSegment(p, prev, cur);
        if (d < min) min = d;
        prev = cur;
      }
    } else {
      const d = distancePointToSegment(p, v0.p, v1.p);
      if (d < min) min = d;
    }
  }
  return min;
}
