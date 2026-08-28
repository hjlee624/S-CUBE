/**
 * NEntity에 Mat3 아핀 변환 적용 — 블록(INSERT) 전개용.
 *
 * 상사변환(회전·균등 스케일·반전·이동)이면 원/원호/bulge를 정확히 보존한다.
 * 비균등 스케일이면 원/원호/bulge 세그먼트를 폴리라인으로 근사(정확도 우선 폴백)한다.
 * 근사 밀도: 완전 원 기준 128분할 (현 오차 ≈ r × 3e-4).
 */
import type { Loop, Mat3, NArc, NEntity, NPolyline, NText, PVertex, Vec2 } from '@s-cube/schema';
import {
  applyMat3,
  isSimilarityMat3,
  mat3Determinant,
  mat3UniformScale,
} from '../geometry/mat3.ts';
import { bulgeToArc } from '../geometry/primitives.ts';

const TWO_PI = Math.PI * 2;

/** 완전 원 기준 폴리라인 근사 분할 수 */
export const ARC_TESSELLATION_SEGMENTS_PER_TURN = 128;

function normalizeAngle(angle: number): number {
  const r = angle % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** CCW 스윕 크기 (a0 === a1 → 완전 원으로 취급) */
function ccwSweep(a0: number, a1: number): number {
  const s = normalizeAngle(a1 - a0);
  return s === 0 ? TWO_PI : s;
}

function arcPoint(center: Vec2, r: number, angle: number): Vec2 {
  return { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) };
}

/** 원호(CCW a0→a1)를 양 끝점 포함 폴리라인 정점열로 근사 */
function sampleArcCcw(center: Vec2, r: number, a0: number, a1: number): Vec2[] {
  const sweep = ccwSweep(a0, a1);
  const steps = Math.max(2, Math.ceil((sweep / TWO_PI) * ARC_TESSELLATION_SEGMENTS_PER_TURN));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push(arcPoint(center, r, a0 + (sweep * i) / steps));
  }
  return pts;
}

/** bulge 세그먼트(v0→v1)를 중간 정점열(끝점 제외)로 근사 */
function sampleBulgeInterior(p0: Vec2, p1: Vec2, bulge: number): Vec2[] {
  const arc = bulgeToArc(p0, p1, bulge);
  const sweep = 4 * Math.atan(Math.abs(bulge));
  const steps = Math.max(2, Math.ceil((sweep / TWO_PI) * ARC_TESSELLATION_SEGMENTS_PER_TURN));
  const dir = arc.ccw ? 1 : -1;
  const pts: Vec2[] = [];
  for (let i = 1; i < steps; i++) {
    pts.push(arcPoint(arc.center, arc.r, arc.a0 + (dir * sweep * i) / steps));
  }
  return pts;
}

/** bulge 세그먼트를 모두 직선으로 풀어낸 정점열 (비균등 스케일 폴백용, 원본 좌표계) */
function tessellateVertices(vertices: PVertex[], closed: boolean): PVertex[] {
  const n = vertices.length;
  const out: PVertex[] = [];
  const segmentCount = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const v0 = vertices[i];
    if (v0 === undefined) continue;
    out.push({ p: v0.p, bulge: 0 });
    if (i >= segmentCount) continue;
    const v1 = vertices[(i + 1) % n];
    if (v1 === undefined || v0.bulge === 0) continue;
    if (v0.p.x === v1.p.x && v0.p.y === v1.p.y) continue;
    for (const p of sampleBulgeInterior(v0.p, v1.p, v0.bulge)) {
      out.push({ p, bulge: 0 });
    }
  }
  return out;
}

function transformVertices(vertices: PVertex[], closed: boolean, m: Mat3): PVertex[] {
  if (isSimilarityMat3(m)) {
    const mirrored = mat3Determinant(m) < 0;
    return vertices.map((v) => ({
      p: applyMat3(m, v.p),
      bulge: mirrored ? -v.bulge : v.bulge,
    }));
  }
  return tessellateVertices(vertices, closed).map((v) => ({ p: applyMat3(m, v.p), bulge: 0 }));
}

/** 상사변환에서의 원호 변환 — 반지름은 균등 스케일 배, 반전(det<0)이면 방향 뒤집어 CCW 유지 */
function transformArcSimilarity(e: NArc, m: Mat3): NArc {
  const center = applyMat3(m, e.center);
  const r = e.r * mat3UniformScale(m);
  const q0 = applyMat3(m, arcPoint(e.center, e.r, e.a0));
  const q1 = applyMat3(m, arcPoint(e.center, e.r, e.a1));
  const b0 = Math.atan2(q0.y - center.y, q0.x - center.x);
  const b1 = Math.atan2(q1.y - center.y, q1.x - center.x);
  const mirrored = mat3Determinant(m) < 0;
  return mirrored ? { ...e, center, r, a0: b1, a1: b0 } : { ...e, center, r, a0: b0, a1: b1 };
}

/**
 * 엔티티에 변환 적용. 비균등 스케일에서 ARC/CIRCLE은 폴리라인 근사로 폴백한다.
 * (원본 kind가 바뀔 수 있음: arc/circle → polyline)
 */
export function transformEntity(e: NEntity, m: Mat3): NEntity {
  switch (e.kind) {
    case 'line':
      return { ...e, a: applyMat3(m, e.a), b: applyMat3(m, e.b) };
    case 'polyline':
      return { ...e, vertices: transformVertices(e.vertices, e.closed, m) };
    case 'arc': {
      if (isSimilarityMat3(m)) return transformArcSimilarity(e, m);
      const pts = sampleArcCcw(e.center, e.r, e.a0, e.a1).map((p) => applyMat3(m, p));
      const polyline: NPolyline = {
        kind: 'polyline',
        handle: e.handle,
        layer: e.layer,
        vertices: pts.map((p) => ({ p, bulge: 0 })),
        closed: false,
      };
      if (e.colorIndex !== undefined) polyline.colorIndex = e.colorIndex;
      if (e.origin !== undefined) polyline.origin = e.origin;
      return polyline;
    }
    case 'circle': {
      if (isSimilarityMat3(m)) {
        return { ...e, center: applyMat3(m, e.center), r: e.r * mat3UniformScale(m) };
      }
      const steps = ARC_TESSELLATION_SEGMENTS_PER_TURN;
      const vertices: PVertex[] = [];
      for (let i = 0; i < steps; i++) {
        const p = arcPoint(e.center, e.r, (TWO_PI * i) / steps);
        vertices.push({ p: applyMat3(m, p), bulge: 0 });
      }
      const polyline: NPolyline = {
        kind: 'polyline',
        handle: e.handle,
        layer: e.layer,
        vertices,
        closed: true,
      };
      if (e.colorIndex !== undefined) polyline.colorIndex = e.colorIndex;
      if (e.origin !== undefined) polyline.origin = e.origin;
      return polyline;
    }
    case 'hatch': {
      const loops: Loop[] = e.loops.map((loop) => ({
        isOuter: loop.isOuter,
        vertices: transformVertices(loop.vertices, true, m),
      }));
      return { ...e, loops };
    }
    case 'text': {
      const scale = isSimilarityMat3(m)
        ? mat3UniformScale(m)
        : Math.sqrt(Math.abs(mat3Determinant(m)));
      const next: NText = {
        kind: 'text',
        handle: e.handle,
        layer: e.layer,
        pos: applyMat3(m, e.pos),
        value: e.value,
        height: e.height * scale,
      };
      if (e.colorIndex !== undefined) next.colorIndex = e.colorIndex;
      if (e.origin !== undefined) next.origin = e.origin;
      // 회전은 각도 합산 대신 기준선(baseline) 방향벡터를 직접 변환해 재계산한다.
      // 미러(det<0) 상사변환에서 mat3Rotation(m)은 반사축 각(2α)을 돌려주므로
      // 단순 합산(θ+2α)은 반사(2α−θ)를 회전으로 오인한다 — 예: 순수 수평 미러의
      // θ=45° 텍스트가 좌우 반전 대신 225° 회전으로 렌더되는 버그.
      const theta = e.rotation ?? 0;
      const dirX = m[0] * Math.cos(theta) + m[1] * Math.sin(theta);
      const dirY = m[3] * Math.cos(theta) + m[4] * Math.sin(theta);
      const rotation = dirX === 0 && dirY === 0 ? theta : Math.atan2(dirY, dirX);
      if (rotation !== 0) next.rotation = rotation;
      // 반전 파리티 전파 — 미러가 두 번 겹치면 상쇄된다.
      // Phase 1 텍스트는 근사 렌더: 렌더러가 이 플래그로 글리프를 기준선 기준 반사한다.
      const mirrored = (e.mirrored === true) !== mat3Determinant(m) < 0;
      if (mirrored) next.mirrored = true;
      return next;
    }
    case 'dimension': {
      const scale = isSimilarityMat3(m)
        ? mat3UniformScale(m)
        : Math.sqrt(Math.abs(mat3Determinant(m)));
      return {
        ...e,
        defPoints: e.defPoints.map((p) => applyMat3(m, p)),
        measuredRaw: e.measuredRaw * scale,
      };
    }
  }
}
