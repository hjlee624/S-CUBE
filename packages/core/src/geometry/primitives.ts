/**
 * 렌더·측정 공용 기하 프리미티브 — 거리·bulge 원호·폴리라인 길이.
 *
 * bulge = tan(θ/4), θ = 포함각. 양수 bulge → 시점에서 종점까지 CCW 원호 (DXF 규약).
 * 내부 계산은 반올림 없이 full precision을 유지한다.
 */
import type { PVertex, Vec2 } from '@s-cube/schema';

/** 두 점 사이 유클리드 거리 */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** bulge 원호의 해석 결과 (각은 라디안, a0→a1 방향은 ccw 플래그를 따른다) */
export interface BulgeArc {
  center: Vec2;
  r: number;
  a0: number;
  a1: number;
  ccw: boolean;
}

/**
 * 정점 a→b, bulge 값으로 정의된 원호 세그먼트를 중심·반지름·시작끝각으로 변환.
 *
 * 유도: s = bulge = tan(θ/4) 일 때
 *   r = d(1+s²)/(4|s|),  중심 = 현 중점 + 현의 좌법선 × d(1−s²)/(4s)/d
 * (s > 1 이면 (1−s²) < 0 이 되어 중심이 현 반대편으로 자동 반전 — θ > π 케이스)
 */
export function bulgeToArc(
  a: Vec2,
  b: Vec2,
  bulge: number,
): { center: Vec2; r: number; a0: number; a1: number; ccw: boolean } {
  if (bulge === 0) {
    throw new Error('bulgeToArc: bulge가 0이면 직선 세그먼트이므로 원호로 변환할 수 없습니다.');
  }
  const d = distance(a, b);
  if (d === 0) {
    throw new Error('bulgeToArc: 시점과 종점이 같아 원호를 정의할 수 없습니다.');
  }
  const s = bulge;
  const r = (d * (1 + s * s)) / (4 * Math.abs(s));
  const k = (1 - s * s) / (4 * s);
  const center: Vec2 = {
    x: (a.x + b.x) / 2 - (b.y - a.y) * k,
    y: (a.y + b.y) / 2 + (b.x - a.x) * k,
  };
  return {
    center,
    r,
    a0: Math.atan2(a.y - center.y, a.x - center.x),
    a1: Math.atan2(b.y - center.y, b.x - center.x),
    ccw: s > 0,
  };
}

/** bulge 세그먼트의 호장 — L = r·θ, θ = 4·atan|bulge| */
export function bulgeSegmentLength(a: Vec2, b: Vec2, bulge: number): number {
  if (bulge === 0) return distance(a, b);
  const chord = distance(a, b);
  if (chord === 0) return 0;
  const sweep = 4 * Math.atan(Math.abs(bulge));
  const { r } = bulgeToArc(a, b, bulge);
  return r * sweep;
}

/**
 * 폴리라인 전체 길이 — 직선 세그먼트 + bulge 원호 호장의 합.
 * closed = true 이면 마지막 정점 → 첫 정점 세그먼트(마지막 정점의 bulge 적용)를 포함한다.
 */
export function polylineLength(vertices: PVertex[], closed: boolean): number {
  const n = vertices.length;
  if (n < 2) return 0;
  const segmentCount = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < segmentCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (v0 === undefined || v1 === undefined) continue;
    total += bulgeSegmentLength(v0.p, v1.p, v0.bulge);
  }
  return total;
}
