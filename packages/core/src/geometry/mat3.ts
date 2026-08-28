/**
 * 2D 아핀 변환 (Mat3) — 블록(INSERT) 전개 시 위치·스케일·회전 누적에 사용.
 *
 * Mat3 = [a, b, tx, c, d, ty] (row-major):
 *   x' = a·x + b·y + tx
 *   y' = c·x + d·y + ty
 */
import type { Mat3, Vec2 } from '@s-cube/schema';

/** 항등 변환 */
export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0];

/** 점 p에 변환 m 적용 */
export function applyMat3(m: Mat3, p: Vec2): Vec2 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

/**
 * 변환 합성 — inner를 먼저 적용하고 outer를 나중에 적용하는 변환을 반환.
 * applyMat3(composeMat3(outer, inner), p) === applyMat3(outer, applyMat3(inner, p))
 */
export function composeMat3(outer: Mat3, inner: Mat3): Mat3 {
  return [
    outer[0] * inner[0] + outer[1] * inner[3],
    outer[0] * inner[1] + outer[1] * inner[4],
    outer[0] * inner[2] + outer[1] * inner[5] + outer[2],
    outer[3] * inner[0] + outer[4] * inner[3],
    outer[3] * inner[1] + outer[4] * inner[4],
    outer[3] * inner[2] + outer[4] * inner[5] + outer[5],
  ];
}

/** 평행이동 변환 */
export function mat3Translation(dx: number, dy: number): Mat3 {
  return [1, 0, dx, 0, 1, dy];
}

/**
 * INSERT 변환 행렬 — T(pos)·R(rotationRad)·S(scaleX, scaleY).
 * 블록 로컬 좌표에 스케일 → 회전 → 이동 순으로 적용된다.
 */
export function mat3FromInsert(
  pos: Vec2,
  scaleX: number,
  scaleY: number,
  rotationRad: number,
): Mat3 {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return [cos * scaleX, -sin * scaleY, pos.x, sin * scaleX, cos * scaleY, pos.y];
}

/** 행렬식 (det < 0 → 반전(mirror) 포함) */
export function mat3Determinant(m: Mat3): number {
  return m[0] * m[4] - m[1] * m[3];
}

/** x축 방향의 회전각 (라디안) */
export function mat3Rotation(m: Mat3): number {
  return Math.atan2(m[3], m[0]);
}

/**
 * 상사변환(similarity) 여부 — 회전·균등 스케일·반전·이동만으로 구성되어
 * 원/원호가 원/원호로 보존되는 변환인지 검사.
 */
export function isSimilarityMat3(m: Mat3): boolean {
  const norm1 = Math.hypot(m[0], m[3]);
  const norm2 = Math.hypot(m[1], m[4]);
  const dot = m[0] * m[1] + m[3] * m[4];
  const scale = Math.max(norm1, norm2);
  if (scale === 0) return false;
  return Math.abs(norm1 - norm2) <= 1e-9 * scale && Math.abs(dot) <= 1e-9 * scale * scale;
}

/** 상사변환의 균등 스케일 계수 (첫 번째 열벡터의 길이) */
export function mat3UniformScale(m: Mat3): number {
  return Math.hypot(m[0], m[3]);
}

/** 항등 변환 여부 */
export function isIdentityMat3(m: Mat3): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0;
}
