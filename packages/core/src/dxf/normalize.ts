/**
 * P1-2: dxf-parser 원시 엔티티 → NEntity 정규화.
 *
 * LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, TEXT, MTEXT(→text), DIMENSION,
 * SOLID(→closed polyline)를 지원한다. INSERT는 expand.ts에서 처리.
 * RW-15: ELLIPSE·SPLINE 는 폴리라인 근사(→NPolyline)로 정규화해 렌더·측정 가능하게 한다.
 * 미지원·불완전 엔티티는 null을 반환하고 호출부에서 타입명별로 집계한다(조용히 버리지 않기).
 */
import type { NDimension, NEntity, NPolyline, NText, PVertex, Vec2 } from '@s-cube/schema';
import { sampleEllipse, sampleSpline } from '../geometry/curves.ts';
import { distance } from '../geometry/primitives.ts';
import { decodeMText } from './mtext.ts';
import type {
  RawArcEntity,
  RawCircleEntity,
  RawDimensionEntity,
  RawEllipseEntity,
  RawEntityBase,
  RawLineEntity,
  RawMtextEntity,
  RawPoint,
  RawPolylineEntity,
  RawSolidEntity,
  RawSplineEntity,
  RawTextEntity,
  RawVertex,
} from './raw-types.ts';

const DEG_TO_RAD = Math.PI / 180;

/** 정규화가 지원하는 DXF 타입 (INSERT는 블록 전개에서 별도 처리) */
export const SUPPORTED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'LINE',
  'LWPOLYLINE',
  'POLYLINE',
  'ARC',
  'CIRCLE',
  'TEXT',
  'MTEXT',
  'DIMENSION',
  'SOLID',
  'ELLIPSE',
  'SPLINE',
]);

function toVec2(p: RawPoint | undefined): Vec2 | null {
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

function toPVertices(raw: RawVertex[] | undefined): PVertex[] {
  const out: PVertex[] = [];
  if (raw === undefined) return out;
  for (const v of raw) {
    const p = toVec2(v);
    if (p === null) continue;
    out.push({ p, bulge: typeof v.bulge === 'number' && Number.isFinite(v.bulge) ? v.bulge : 0 });
  }
  return out;
}

interface NBaseFields {
  handle: string;
  layer: string;
  colorIndex?: number;
}

function baseFields(raw: RawEntityBase): NBaseFields {
  const base: NBaseFields = {
    handle: raw.handle !== undefined ? String(raw.handle) : '',
    layer: raw.layer ?? '0',
  };
  if (typeof raw.colorIndex === 'number') base.colorIndex = raw.colorIndex;
  return base;
}

function normalizeLine(raw: RawLineEntity): NEntity | null {
  const a = toVec2(raw.vertices?.[0]);
  const b = toVec2(raw.vertices?.[1]);
  if (a === null || b === null) return null;
  return { kind: 'line', ...baseFields(raw), a, b };
}

function normalizePolyline(raw: RawPolylineEntity): NEntity | null {
  const vertices = toPVertices(raw.vertices);
  if (vertices.length < 2) return null;
  return { kind: 'polyline', ...baseFields(raw), vertices, closed: raw.shape === true };
}

function normalizeArc(raw: RawArcEntity): NEntity | null {
  const center = toVec2(raw.center);
  if (center === null || typeof raw.radius !== 'number') return null;
  if (typeof raw.startAngle !== 'number' || typeof raw.endAngle !== 'number') return null;
  // dxf-parser가 이미 라디안으로 변환. DXF ARC는 항상 CCW (a0 → a1)
  return {
    kind: 'arc',
    ...baseFields(raw),
    center,
    r: raw.radius,
    a0: raw.startAngle,
    a1: raw.endAngle,
  };
}

function normalizeCircle(raw: RawCircleEntity): NEntity | null {
  const center = toVec2(raw.center);
  if (center === null || typeof raw.radius !== 'number') return null;
  return { kind: 'circle', ...baseFields(raw), center, r: raw.radius };
}

function normalizeText(raw: RawTextEntity): NEntity | null {
  const pos = toVec2(raw.startPoint);
  if (pos === null) return null;
  const entity: NText = {
    kind: 'text',
    ...baseFields(raw),
    pos,
    // TEXT는 서식코드가 거의 없지만 \U+·\P 등이 드물게 섞이므로 동일 디코딩(멱등)한다
    value: decodeMText(raw.text ?? ''),
    height: typeof raw.textHeight === 'number' ? raw.textHeight : 0,
  };
  if (typeof raw.rotation === 'number' && raw.rotation !== 0) {
    entity.rotation = raw.rotation * DEG_TO_RAD;
  }
  return entity;
}

function normalizeMtext(raw: RawMtextEntity): NEntity | null {
  const pos = toVec2(raw.position);
  if (pos === null) return null;
  const entity: NText = {
    kind: 'text',
    ...baseFields(raw),
    pos,
    // MTEXT 서식코드(\P·\C#·\S 분수·중괄호 그룹 등)를 평문으로 디코딩. 결과에 \n 포함 가능.
    value: decodeMText(raw.text ?? ''),
    height: typeof raw.height === 'number' ? raw.height : 0,
  };
  if (typeof raw.rotation === 'number' && raw.rotation !== 0) {
    entity.rotation = raw.rotation * DEG_TO_RAD;
  }
  return entity;
}

function normalizeDimension(raw: RawDimensionEntity): NDimension | null {
  const defPoints: Vec2[] = [];
  for (const p of [raw.anchorPoint, raw.linearOrAngularPoint1, raw.linearOrAngularPoint2]) {
    const v = toVec2(p);
    if (v !== null) defPoints.push(v);
  }
  const p13 = toVec2(raw.linearOrAngularPoint1);
  const p14 = toVec2(raw.linearOrAngularPoint2);
  let measuredRaw = 0;
  if (typeof raw.actualMeasurement === 'number' && Number.isFinite(raw.actualMeasurement)) {
    measuredRaw = raw.actualMeasurement;
  } else if (p13 !== null && p14 !== null) {
    // 그룹코드 42 부재 시 측정점 거리로 폴백
    measuredRaw = distance(p13, p14);
  }
  // '<>'는 "실측값을 표시하라"는 뜻이므로 override가 아니다
  const textOverride =
    raw.text !== undefined && raw.text !== '' && raw.text !== '<>' ? raw.text : null;
  return { kind: 'dimension', ...baseFields(raw), defPoints, measuredRaw, textOverride };
}

function normalizeSolid(raw: RawSolidEntity): NEntity | null {
  const pts = (raw.points ?? []).map(toVec2).filter((p): p is Vec2 => p !== null);
  const [q0, q1, q2, q3] = pts;
  if (q0 === undefined || q1 === undefined || q2 === undefined) return null;
  // DXF SOLID 정점 순서는 p1,p2,p3,p4가 나비꼴(bowtie) — 외곽선은 p1,p2,p4,p3
  const ordered: Vec2[] = q3 !== undefined ? [q0, q1, q3, q2] : [q0, q1, q2];
  return {
    kind: 'polyline',
    ...baseFields(raw),
    vertices: ordered.map((p) => ({ p, bulge: 0 })),
    closed: true,
  };
}

/**
 * ELLIPSE → 폴리라인 근사(파라미터 균등 샘플).
 * 완전 타원(start===end)이면 closed=true, 타원호면 closed=false 로 정규화한다.
 * dxf-parser는 그룹코드 41/42를 startAngle/endAngle(라디안 파라미터각)로 노출한다.
 */
function normalizeEllipse(raw: RawEllipseEntity): NEntity | null {
  const center = toVec2(raw.center);
  const majorEnd = toVec2(raw.majorAxisEndPoint);
  if (center === null || majorEnd === null) return null;
  const ratio =
    typeof raw.axisRatio === 'number' && Number.isFinite(raw.axisRatio) ? raw.axisRatio : 1;
  const start =
    typeof raw.startAngle === 'number' && Number.isFinite(raw.startAngle) ? raw.startAngle : 0;
  const end =
    typeof raw.endAngle === 'number' && Number.isFinite(raw.endAngle) ? raw.endAngle : Math.PI * 2;
  // majorAxisEndPoint는 center 기준 상대 벡터.
  const major: Vec2 = { x: majorEnd.x, y: majorEnd.y };
  if (major.x === 0 && major.y === 0) return null;
  const closed = normalizedFullTurn(start, end);
  const pts = sampleEllipse(center, major, ratio, start, end);
  const vertices = pts.map<PVertex>((p) => ({ p, bulge: 0 }));
  if (vertices.length < 2) return null;
  return { kind: 'polyline', ...baseFields(raw), vertices, closed };
}

/** start~end 스윕이 완전 회전(2π)인가 — 완전 타원/원 판정 */
function normalizedFullTurn(start: number, end: number): boolean {
  const TWO_PI = Math.PI * 2;
  const diff = (((end - start) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff === 0;
}

/**
 * SPLINE → 폴리라인 근사. knot/차수가 유효하면 de Boor 평가, 아니면 제어점/맞춤점 직결(근사).
 * 제어점이 없으면 맞춤점(fit points)을 정점으로 사용한다.
 * closed 플래그(그룹코드 70 bit0)를 폐합 여부에 반영한다.
 */
function normalizeSpline(raw: RawSplineEntity): NEntity | null {
  const closed = raw.closed === true;
  const ctrl = (raw.controlPoints ?? []).map(toVec2).filter((p): p is Vec2 => p !== null);
  const fit = (raw.fitPoints ?? []).map(toVec2).filter((p): p is Vec2 => p !== null);
  const degree =
    typeof raw.degreeOfSplineCurve === 'number' && raw.degreeOfSplineCurve >= 1
      ? raw.degreeOfSplineCurve
      : 3;
  let pts: Vec2[];
  if (ctrl.length >= 2) {
    const knots = (raw.knotValues ?? []).filter((k) => Number.isFinite(k));
    const weights =
      raw.weights !== undefined && raw.weights.length === ctrl.length
        ? raw.weights.filter((w) => Number.isFinite(w))
        : undefined;
    pts = sampleSpline(ctrl, degree, knots.length > 0 ? knots : undefined, weights, closed);
  } else if (fit.length >= 2) {
    // 제어점 없음 → 맞춤점을 폴리라인으로 직결(근사)
    pts = fit;
  } else {
    return null;
  }
  const vertices = pts.map<PVertex>((p) => ({ p, bulge: 0 }));
  if (vertices.length < 2) return null;
  const poly: NPolyline = { kind: 'polyline', ...baseFields(raw), vertices, closed };
  return poly;
}

/**
 * 원시 엔티티 1건 정규화. 미지원 타입·불완전 데이터는 null.
 * (호출부는 null이면 raw.type 기준으로 unsupportedCounts에 집계한다)
 */
export function normalizeEntity(raw: RawEntityBase): NEntity | null {
  switch (raw.type) {
    case 'LINE':
      return normalizeLine(raw as RawLineEntity);
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return normalizePolyline(raw as RawPolylineEntity);
    case 'ARC':
      return normalizeArc(raw as RawArcEntity);
    case 'CIRCLE':
      return normalizeCircle(raw as RawCircleEntity);
    case 'TEXT':
      return normalizeText(raw as RawTextEntity);
    case 'MTEXT':
      return normalizeMtext(raw as RawMtextEntity);
    case 'DIMENSION':
      return normalizeDimension(raw as RawDimensionEntity);
    case 'SOLID':
      return normalizeSolid(raw as RawSolidEntity);
    case 'ELLIPSE':
      return normalizeEllipse(raw as RawEllipseEntity);
    case 'SPLINE':
      return normalizeSpline(raw as RawSplineEntity);
    default:
      return null;
  }
}
