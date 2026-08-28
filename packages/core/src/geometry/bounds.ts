/**
 * 엔티티 경계 상자 (Bounds) — Zoom Extents·히트테스트용.
 * 원호는 사분점(0, π/2, π, 3π/2)이 스윕에 포함되는지 검사해 타이트한 bbox를 만든다.
 */
import type { Bounds, Loop, NEntity, PVertex, Vec2 } from '@s-cube/schema';
import { bulgeToArc } from './primitives.ts';

const TWO_PI = Math.PI * 2;

/** [0, 2π) 범위로 정규화 */
function normalizeAngle(angle: number): number {
  const r = angle % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * CCW 스윕(a0→a1)에 각 q가 포함되는지.
 * a0 === a1 (스윕 0)은 완전 원으로 취급한다.
 */
function angleInCcwSweep(q: number, a0: number, a1: number): boolean {
  const sweep = normalizeAngle(a1 - a0);
  if (sweep === 0) return true; // 완전 원
  return normalizeAngle(q - a0) <= sweep;
}

function pointBounds(p: Vec2): Bounds {
  return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
}

function includePoint(b: Bounds, p: Vec2): Bounds {
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

/** 원호(항상 CCW, a0→a1)의 타이트 bbox — 양 끝점 + 스윕에 포함된 사분점 */
export function arcBounds(center: Vec2, r: number, a0: number, a1: number): Bounds {
  const p0: Vec2 = { x: center.x + r * Math.cos(a0), y: center.y + r * Math.sin(a0) };
  const p1: Vec2 = { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) };
  let b = includePoint(pointBounds(p0), p1);
  const quadrants = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const q of quadrants) {
    if (angleInCcwSweep(q, a0, a1)) {
      b = includePoint(b, { x: center.x + r * Math.cos(q), y: center.y + r * Math.sin(q) });
    }
  }
  return b;
}

/** 폴리라인 bbox — 정점 + bulge 원호 세그먼트의 타이트 bbox */
function polylineBounds(vertices: PVertex[], closed: boolean): Bounds | null {
  const n = vertices.length;
  const first = vertices[0];
  if (first === undefined) return null;
  let b = pointBounds(first.p);
  for (const v of vertices) {
    b = includePoint(b, v.p);
  }
  const segmentCount = closed ? n : n - 1;
  for (let i = 0; i < segmentCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (v0 === undefined || v1 === undefined) continue;
    if (v0.bulge === 0) continue;
    if (v0.p.x === v1.p.x && v0.p.y === v1.p.y) continue;
    const arc = bulgeToArc(v0.p, v1.p, v0.bulge);
    // NArc 규약과 동일하게 CCW 방향으로 정렬해 사분점 검사
    const ab = arc.ccw
      ? arcBounds(arc.center, arc.r, arc.a0, arc.a1)
      : arcBounds(arc.center, arc.r, arc.a1, arc.a0);
    b = includePoint(includePoint(b, { x: ab.minX, y: ab.minY }), { x: ab.maxX, y: ab.maxY });
  }
  return b;
}

function loopsBounds(loops: Loop[]): Bounds | null {
  const list = loops.map((loop) => polylineBounds(loop.vertices, true));
  return mergeBounds(list);
}

/**
 * 엔티티 단일 bbox. 계산 불가(정점 없음 등)이면 null.
 * TEXT는 폰트 메트릭이 없으므로 삽입점만 포함한다.
 */
export function entityBounds(e: NEntity): Bounds | null {
  switch (e.kind) {
    case 'line':
      return includePoint(pointBounds(e.a), e.b);
    case 'polyline':
      return polylineBounds(e.vertices, e.closed);
    case 'arc':
      return arcBounds(e.center, e.r, e.a0, e.a1);
    case 'circle':
      return {
        minX: e.center.x - e.r,
        minY: e.center.y - e.r,
        maxX: e.center.x + e.r,
        maxY: e.center.y + e.r,
      };
    case 'hatch':
      return loopsBounds(e.loops);
    case 'text':
      return pointBounds(e.pos);
    case 'dimension': {
      const first = e.defPoints[0];
      if (first === undefined) return null;
      let b = pointBounds(first);
      for (const p of e.defPoints) {
        b = includePoint(b, p);
      }
      return b;
    }
  }
}

/** 여러 bbox 병합 — null은 무시, 전부 null이면 null */
export function mergeBounds(list: (Bounds | null)[]): Bounds | null {
  let acc: Bounds | null = null;
  for (const b of list) {
    if (b === null) continue;
    acc =
      acc === null
        ? { ...b }
        : {
            minX: Math.min(acc.minX, b.minX),
            minY: Math.min(acc.minY, b.minY),
            maxX: Math.max(acc.maxX, b.maxX),
            maxY: Math.max(acc.maxY, b.maxY),
          };
  }
  return acc;
}
