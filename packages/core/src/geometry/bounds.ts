/**
 * 엔티티 경계 상자 (Bounds) — Zoom Extents·히트테스트용.
 * 원호는 사분점(0, π/2, π, 3π/2)이 스윕에 포함되는지 검사해 타이트한 bbox를 만든다.
 */
import type { Bounds, Loop, NEntity, PVertex, Vec2 } from '@s-cube/schema';
import { bulgeToArc } from './primitives.ts';

const TWO_PI = Math.PI * 2;

/**
 * bounds 계산에서 제외할 좌표 성분 상한(절대값). sanitize.ts의 COORD_SANE_LIMIT와 동일 의미의
 * 방어적 중복 안전장치 — 위생처리가 선행되지 않은 경로에서도 비유한·초과 좌표가 bounds를
 * 오염시키지 않게 한다.
 */
const BOUNDS_COORD_LIMIT = 1e12;

/** 좌표 성분이 bounds에 반영해도 되는가 (유한 + 절대값 ≤ 상한) */
function isBoundableCoord(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= BOUNDS_COORD_LIMIT;
}

/** 점의 두 성분이 모두 반영 가능한가 */
function isBoundablePoint(p: Vec2): boolean {
  return isBoundableCoord(p.x) && isBoundableCoord(p.y);
}

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

/** 점을 bounds에 병합. 비유한·초과 좌표는 무시한다(방어적 중복 안전장치). */
function includePoint(b: Bounds, p: Vec2): Bounds {
  if (!isBoundablePoint(p)) return b;
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

/** 정점 목록에서 첫 번째 반영 가능한 점으로 seed Bounds 생성. 없으면 null. */
function seedBounds(points: Iterable<Vec2>): Bounds | null {
  for (const p of points) {
    if (isBoundablePoint(p)) return pointBounds(p);
  }
  return null;
}

/**
 * 원호(항상 CCW, a0→a1)의 타이트 bbox — 양 끝점 + 스윕에 포함된 사분점.
 * center/r/각이 손상이면 null(위생처리 선행이면 도달하지 않는 방어적 경로).
 */
export function arcBounds(center: Vec2, r: number, a0: number, a1: number): Bounds | null {
  const p0: Vec2 = { x: center.x + r * Math.cos(a0), y: center.y + r * Math.sin(a0) };
  const p1: Vec2 = { x: center.x + r * Math.cos(a1), y: center.y + r * Math.sin(a1) };
  let b = seedBounds([p0, p1]);
  if (b === null) return null;
  b = includePoint(b, p1);
  const quadrants = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const q of quadrants) {
    if (angleInCcwSweep(q, a0, a1)) {
      b = includePoint(b, { x: center.x + r * Math.cos(q), y: center.y + r * Math.sin(q) });
    }
  }
  return b;
}

/** 폴리라인 bbox — 정점 + bulge 원호 세그먼트의 타이트 bbox. 유효 정점 없으면 null */
function polylineBounds(vertices: PVertex[], closed: boolean): Bounds | null {
  const n = vertices.length;
  let b = seedBounds(vertices.map((v) => v.p));
  if (b === null) return null;
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
    // 손상 정점 위 세그먼트는 bulge 원호 계산에서 제외(위생처리 선행이면 도달 안 함)
    if (!isBoundablePoint(v0.p) || !isBoundablePoint(v1.p)) continue;
    const arc = bulgeToArc(v0.p, v1.p, v0.bulge);
    // NArc 규약과 동일하게 CCW 방향으로 정렬해 사분점 검사
    const ab = arc.ccw
      ? arcBounds(arc.center, arc.r, arc.a0, arc.a1)
      : arcBounds(arc.center, arc.r, arc.a1, arc.a0);
    if (ab === null) continue;
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
    case 'line': {
      const seed = seedBounds([e.a, e.b]);
      if (seed === null) return null;
      return includePoint(includePoint(seed, e.a), e.b);
    }
    case 'polyline':
      return polylineBounds(e.vertices, e.closed);
    case 'arc':
      return arcBounds(e.center, e.r, e.a0, e.a1);
    case 'circle': {
      if (!isBoundablePoint(e.center) || !isBoundableCoord(e.r)) return null;
      return {
        minX: e.center.x - e.r,
        minY: e.center.y - e.r,
        maxX: e.center.x + e.r,
        maxY: e.center.y + e.r,
      };
    }
    case 'hatch':
      return loopsBounds(e.loops);
    case 'text':
      return isBoundablePoint(e.pos) ? pointBounds(e.pos) : null;
    case 'dimension': {
      let b = seedBounds(e.defPoints);
      if (b === null) return null;
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
