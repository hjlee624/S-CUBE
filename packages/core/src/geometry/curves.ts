/**
 * 곡선 → 폴리라인 근사 샘플러 (ELLIPSE·SPLINE·원호 edge).
 *
 * RW-15(ELLIPSE/SPLINE 정규화)·RW-2(HATCH edge-type 경계)에서 공용으로 쓴다.
 * 반환 좌표는 **도면 단위** 순수 기하이며 반올림하지 않는다(21-CONVENTIONS §4).
 *
 * - 원호(arc)·타원(ellipse)은 파라미터 균등 샘플. 완전 회전(2π) 기준 분할 수로 밀도 조절.
 * - SPLINE은 de Boor(clamped/주기 knot)로 곡선을 평가하되, knot 정보가 없거나 불충분하면
 *   제어점(control) 또는 맞춤점(fit) 자체를 폴리라인 정점으로 직결한다(근사 유지).
 */
import type { Vec2 } from '@s-cube/schema';

const TWO_PI = Math.PI * 2;

/** 완전 원/타원 기준 폴리라인 근사 분할 수 (transform.ts와 동일 밀도) */
export const CURVE_SEGMENTS_PER_TURN = 128;

function normalizeAngle(angle: number): number {
  const r = angle % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** CCW 스윕 크기 (a0 === a1 → 완전 회전으로 취급) */
function ccwSweep(a0: number, a1: number): number {
  const s = normalizeAngle(a1 - a0);
  return s === 0 ? TWO_PI : s;
}

/** 스윕 각(라디안)에 비례한 분할 수 — 최소 2, 완전 회전에서 CURVE_SEGMENTS_PER_TURN */
function stepsForSweep(sweep: number): number {
  return Math.max(2, Math.ceil((Math.abs(sweep) / TWO_PI) * CURVE_SEGMENTS_PER_TURN));
}

/**
 * 원호(CCW a0→a1)를 양 끝점 포함 폴리라인 정점열로 근사.
 * a0 === a1 이면 완전 원(2π)로 취급하되 끝점 중복을 피해 마지막 정점은 제외한다(호출부 폐합).
 */
export function sampleArc(center: Vec2, r: number, a0: number, a1: number, ccw: boolean): Vec2[] {
  const sweep = ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
  const fullTurn = normalizeAngle(a1 - a0) === 0;
  const steps = stepsForSweep(sweep);
  const pts: Vec2[] = [];
  // 완전 원은 마지막 정점(=첫 정점)을 생략해 중복 폐합을 막는다.
  const last = fullTurn ? steps - 1 : steps;
  for (let i = 0; i <= last; i++) {
    const ang = a0 + (sweep * i) / steps;
    pts.push({ x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) });
  }
  return pts;
}

/**
 * 타원/타원호를 폴리라인 정점열로 근사.
 *
 * DXF ELLIPSE 파라미터화: 점 = center + cos(t)·majorAxis + sin(t)·minorAxis,
 * 여기서 majorAxis = (majorEndX, majorEndY)(center 기준 상대), minorAxis = axisRatio·(장축을 +90° 회전).
 * t는 **파라미터각**(기하각 아님)이며 start~end 를 CCW로 스윕한다.
 * start === end(전각 0)면 완전 타원(0~2π)로 취급한다.
 */
export function sampleEllipse(
  center: Vec2,
  major: Vec2,
  axisRatio: number,
  startParam: number,
  endParam: number,
): Vec2[] {
  const sweep = ccwSweep(startParam, endParam);
  const fullTurn = normalizeAngle(endParam - startParam) === 0;
  const steps = stepsForSweep(sweep);
  // 부축 = 장축을 +90°(CCW) 회전한 벡터 × axisRatio
  const minor: Vec2 = { x: -major.y * axisRatio, y: major.x * axisRatio };
  const pts: Vec2[] = [];
  const last = fullTurn ? steps - 1 : steps;
  for (let i = 0; i <= last; i++) {
    const t = startParam + (sweep * i) / steps;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    pts.push({
      x: center.x + cos * major.x + sin * minor.x,
      y: center.y + cos * major.y + sin * minor.y,
    });
  }
  return pts;
}

/**
 * NURBS/B-spline 곡선을 폴리라인 정점열로 근사한다.
 *
 * knot 벡터·차수가 유효하면 de Boor로 매개변수 균등 평가한다(rational 가중치 지원).
 * knot 정보가 없거나(numberOfKnots=0) 불충분하면 제어 다각형을 그대로 반환한다(근사 폴백).
 * 반환 정점 밀도는 세그먼트당 약 CURVE_SEGMENTS_PER_TURN/8 로, 곡선 복잡도에 비례해 늘린다.
 */
export function sampleSpline(
  controlPoints: Vec2[],
  degree: number,
  knots: number[] | undefined,
  weights: number[] | undefined,
  closed: boolean,
): Vec2[] {
  const n = controlPoints.length;
  if (n === 0) return [];
  if (n === 1) return [controlPoints[0] as Vec2];
  // knot 유효성: 길이 = n + degree + 1 이어야 de Boor 평가 가능.
  const canEvaluate =
    degree >= 1 && knots !== undefined && knots.length === n + degree + 1 && n > degree;
  if (!canEvaluate) {
    // 폴백: 제어 다각형을 정점으로 직결(근사). closed면 호출부가 폐합.
    return controlPoints.map((p) => ({ x: p.x, y: p.y }));
  }
  const kv = knots as number[];
  const domainStart = kv[degree] as number;
  const domainEnd = kv[n] as number;
  if (!(domainEnd > domainStart)) {
    return controlPoints.map((p) => ({ x: p.x, y: p.y }));
  }
  // 샘플 수: 제어점·차수에 비례. 최소 (n*8), 최대 512.
  const samples = Math.min(512, Math.max(n * 8, CURVE_SEGMENTS_PER_TURN));
  const out: Vec2[] = [];
  const lastSample = closed ? samples - 1 : samples;
  for (let i = 0; i <= lastSample; i++) {
    const u = domainStart + ((domainEnd - domainStart) * i) / samples;
    out.push(deBoor(controlPoints, degree, kv, weights, u));
  }
  return out;
}

/** knot span index 검색 — u가 속한 구간 [kv[i], kv[i+1]) */
function findSpan(n: number, degree: number, u: number, kv: number[]): number {
  const high = n; // 마지막 유효 span
  if (u >= (kv[high] as number)) return high - 1;
  if (u <= (kv[degree] as number)) return degree;
  let low = degree;
  let hi = high;
  let mid = Math.floor((low + hi) / 2);
  while (u < (kv[mid] as number) || u >= (kv[mid + 1] as number)) {
    if (u < (kv[mid] as number)) hi = mid;
    else low = mid;
    mid = Math.floor((low + hi) / 2);
  }
  return mid;
}

/** de Boor 알고리즘 — u에서 (rational) B-spline 곡선 점 평가 */
function deBoor(
  ctrl: Vec2[],
  degree: number,
  kv: number[],
  weights: number[] | undefined,
  u: number,
): Vec2 {
  const n = ctrl.length;
  const span = findSpan(n, degree, u, kv);
  const rational = weights !== undefined && weights.length === n;
  // 동차좌표 (x·w, y·w, w) 로 작업점을 만들어 rational 지원.
  const dx: number[] = new Array(degree + 1);
  const dy: number[] = new Array(degree + 1);
  const dw: number[] = new Array(degree + 1);
  for (let j = 0; j <= degree; j++) {
    const idx = span - degree + j;
    const cp = ctrl[idx] as Vec2;
    const w = rational ? ((weights as number[])[idx] as number) : 1;
    dx[j] = cp.x * w;
    dy[j] = cp.y * w;
    dw[j] = w;
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = span - degree + j;
      const denom = (kv[i + degree - r + 1] as number) - (kv[i] as number);
      const alpha = denom === 0 ? 0 : (u - (kv[i] as number)) / denom;
      dx[j] = (1 - alpha) * (dx[j - 1] as number) + alpha * (dx[j] as number);
      dy[j] = (1 - alpha) * (dy[j - 1] as number) + alpha * (dy[j] as number);
      dw[j] = (1 - alpha) * (dw[j - 1] as number) + alpha * (dw[j] as number);
    }
  }
  const w = dw[degree] as number;
  if (w === 0) return { x: dx[degree] as number, y: dy[degree] as number };
  return { x: (dx[degree] as number) / w, y: (dy[degree] as number) / w };
}
