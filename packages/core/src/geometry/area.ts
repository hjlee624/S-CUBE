/**
 * 면적 · 포함 판정 — shoelace + bulge 활꼴(circular segment) 보정.
 *
 * 각주: 면적은 **도면 단위²** 로 반환한다. 미터 변환(×scale²)은 web 경계에서 1회만 수행하며,
 * core 는 도면 단위 순수 기하만 다룬다(21-CONVENTIONS §4). 내부 계산은 반올림하지 않는다.
 */
import type { Loop, PVertex, Vec2 } from '@s-cube/schema';
import { distancePointToSegment } from './hittest.ts';
import { bulgeToArc, distance } from './primitives.ts';

/**
 * shoelace 부호 면적 — CCW 다각형은 양수, CW 는 음수. 방향 판정에 사용한다.
 * 정점은 직선 폐합(마지막→첫 정점)을 가정한 순수 shoelace(직선 근사)다.
 * A = ½ Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)
 */
export function signedArea(pts: Vec2[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    if (p === undefined || q === undefined) continue;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/**
 * 정점 a→b 원호 세그먼트가 폴리곤 면적(shoelace)에 더하는 활꼴(circular segment) **부호** 면적.
 *
 * 유도: 부호 스윕각 θ = 4·atan(bulge). 현과 호 사이 활꼴의 부호 면적은
 *   A_seg = ½·r²·(θ − sin θ)   (r 은 bulgeToArc 로 구한 반지름)
 * bulge > 0(CCW)이면 θ > 0 → 현 왼쪽(볼록)으로 면적을 더한다. θ > π(bulge > 1)도 자동 처리된다.
 * bulge = 0(직선) 또는 두 점이 동일하면 0.
 */
export function bulgeSegmentArea(a: Vec2, b: Vec2, bulge: number): number {
  if (bulge === 0) return 0;
  if (distance(a, b) === 0) return 0;
  const { r } = bulgeToArc(a, b, bulge);
  const theta = 4 * Math.atan(bulge);
  return 0.5 * r * r * (theta - Math.sin(theta));
}

/**
 * 폴리라인 부호 면적 — shoelace(직선 근사) + Σ bulgeSegmentArea 보정.
 * 열린 폴리라인(closed=false)이면 시점-종점 직선 자동 폐합을 가정한다.
 * 마지막 정점의 bulge 는 폐합 세그먼트(마지막→첫 정점)의 원호로 해석한다(closed=true 일 때).
 * closed=false 이면 폐합 세그먼트는 직선으로만 잇고 bulge 는 적용하지 않는다.
 */
export function polygonSignedArea(vertices: PVertex[], closed: boolean): number {
  const n = vertices.length;
  // 직선 폴리곤은 정점 3개 이상 필요하나, bulge 원호는 정점 2개(반원+지름, 완전 원)로도
  // 유효 면적을 가진다. shoelace(2점)=0 이 되고 면적은 bulgeSegmentArea 가 공급한다.
  if (n < 2) return 0;
  const pts = vertices.map((v) => v.p);
  let area = signedArea(pts);
  // 원호 보정 — closed 이면 마지막→첫 세그먼트까지(n개), 아니면 마지막 정점 제외(n-1개)
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (v0 === undefined || v1 === undefined) continue;
    area += bulgeSegmentArea(v0.p, v1.p, v0.bulge);
  }
  return area;
}

/**
 * 폴리라인 **절대** 면적(도면 단위²) — 부호를 제거한 값.
 * 열린 폴리라인이면 시점-종점 자동 폐합을 가정한다(폐합 여부 알림은 isImplicitlyClosed 로 별도 제공).
 */
export function polygonArea(vertices: PVertex[], closed: boolean): number {
  return Math.abs(polygonSignedArea(vertices, closed));
}

/**
 * 열린 폴리라인이 면적 계산 시 자동(암묵) 폐합되는가.
 * closed=false 이고 시점≠종점이면 true — 호출측(web 2-C)에서 "폐합되지 않음" 경고에 쓴다.
 */
export function isImplicitlyClosed(vertices: PVertex[], closed: boolean): boolean {
  if (closed) return false;
  const n = vertices.length;
  if (n < 3) return false;
  const first = vertices[0];
  const last = vertices[n - 1];
  if (first === undefined || last === undefined) return false;
  return distance(first.p, last.p) > 0;
}

/** 원호 세그먼트를 직선 근사로 분할할 최소 조각 수 — bulge 곡률이 클수록 촘촘히. */
function arcSubdivisions(bulge: number): number {
  const sweep = 4 * Math.atan(Math.abs(bulge));
  // 스윕 각을 약 12° 조각으로 나눈다. 최소 4, 최대 64.
  const n = Math.ceil(sweep / (Math.PI / 15));
  return Math.min(64, Math.max(4, n));
}

/**
 * 폴리라인을 직선 정점 열로 평탄화 — bulge 원호는 여러 직선으로 근사 분할.
 * ray casting·세그먼트 거리 판정에 쓸 근사 폴리곤 정점을 만든다.
 */
function flattenVertices(vertices: PVertex[], closed: boolean): Vec2[] {
  const n = vertices.length;
  if (n === 0) return [];
  const out: Vec2[] = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (v0 === undefined || v1 === undefined) continue;
    out.push(v0.p);
    if (v0.bulge !== 0 && distance(v0.p, v1.p) > 0) {
      const arc = bulgeToArc(v0.p, v1.p, v0.bulge);
      const steps = arcSubdivisions(v0.bulge);
      // a0→a1 을 스윕 방향(ccw/cw)으로 보간
      let sweep = arc.a1 - arc.a0;
      if (arc.ccw) {
        while (sweep <= 0) sweep += 2 * Math.PI;
      } else {
        while (sweep >= 0) sweep -= 2 * Math.PI;
      }
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const ang = arc.a0 + sweep * t;
        out.push({
          x: arc.center.x + arc.r * Math.cos(ang),
          y: arc.center.y + arc.r * Math.sin(ang),
        });
      }
    }
  }
  if (!closed) {
    const lastV = vertices[n - 1];
    if (lastV !== undefined) out.push(lastV.p);
  }
  return out;
}

/**
 * 점 포함 판정 (ray casting) — 폴리라인을 직선 근사(bulge 분할)해 홀짝 규칙으로 판정.
 * 경계 근처(tolerance 이내)는 포함으로 처리한다.
 */
export function pointInPolygon(p: Vec2, vertices: PVertex[], tolerance = 1e-9): boolean {
  const poly = flattenVertices(vertices, true);
  const n = poly.length;
  if (n < 3) return false;
  // 경계 tolerance — 어느 변에라도 tolerance 이내면 포함으로 본다
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    if (distancePointToSegment(p, a, b) <= tolerance) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 구멍(island) 차감 순 면적 — even-odd 규칙.
 * 외곽 절대 면적에서 각 구멍의 절대 면적을 차감한다(음수면 0으로 클램프).
 */
export function netAreaWithHoles(outer: PVertex[], holes: PVertex[][]): number {
  const outerArea = polygonArea(outer, true);
  let holeArea = 0;
  for (const hole of holes) {
    holeArea += polygonArea(hole, true);
  }
  return Math.max(0, outerArea - holeArea);
}

/**
 * HATCH 면적 — Loop 들에서 외곽(isOuter) 면적 합 − 내부 루프 면적 합.
 * 다중 외곽/내부 루프를 모두 지원한다(음수면 0으로 클램프).
 */
export function hatchArea(loops: Loop[]): number {
  let outer = 0;
  let inner = 0;
  for (const loop of loops) {
    const a = polygonArea(loop.vertices, true);
    if (loop.isOuter) outer += a;
    else inner += a;
  }
  return Math.max(0, outer - inner);
}
