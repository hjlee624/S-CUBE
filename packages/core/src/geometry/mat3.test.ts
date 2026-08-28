import type { Mat3, Vec2 } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  applyMat3,
  composeMat3,
  IDENTITY_MAT3,
  isIdentityMat3,
  isSimilarityMat3,
  mat3Determinant,
  mat3FromInsert,
  mat3Rotation,
  mat3Translation,
  mat3UniformScale,
} from './mat3.ts';

function expectVecClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('applyMat3', () => {
  it('항등 변환은 점을 보존한다', () => {
    expectVecClose(applyMat3(IDENTITY_MAT3, { x: 3.5, y: -2.25 }), { x: 3.5, y: -2.25 });
  });

  it('평행이동', () => {
    expectVecClose(applyMat3(mat3Translation(5, -7), { x: 1, y: 2 }), { x: 6, y: -5 });
  });
});

describe('mat3FromInsert', () => {
  it('회전 90° — (1,0)이 삽입점 기준 (0,1) 방향으로 이동', () => {
    const m = mat3FromInsert({ x: 10, y: 20 }, 1, 1, Math.PI / 2);
    expectVecClose(applyMat3(m, { x: 1, y: 0 }), { x: 10, y: 21 });
    expectVecClose(applyMat3(m, { x: 0, y: 1 }), { x: 9, y: 20 });
  });

  it('스케일 → 회전 → 이동 순서 적용', () => {
    // (1,0) → 스케일(2,3): (2,0) → 회전 90°: (0,2) → 이동 (5,0): (5,2)
    const m = mat3FromInsert({ x: 5, y: 0 }, 2, 3, Math.PI / 2);
    expectVecClose(applyMat3(m, { x: 1, y: 0 }), { x: 5, y: 2 });
    // (0,1) → (0,3) → (-3,0) → (2,0)
    expectVecClose(applyMat3(m, { x: 0, y: 1 }), { x: 2, y: 0 });
  });
});

describe('composeMat3', () => {
  it('compose(outer, inner) 적용 = inner 먼저, outer 나중', () => {
    const outer = mat3FromInsert({ x: 5, y: 0 }, 1, 1, Math.PI / 2);
    const inner = mat3FromInsert({ x: 0, y: 0 }, 2, 3, 0);
    const m = composeMat3(outer, inner);
    // (1,1) → inner: (2,3) → rot90: (-3,2) → +(5,0): (2,2)
    expectVecClose(applyMat3(m, { x: 1, y: 1 }), { x: 2, y: 2 });
  });

  it('합성 결과가 순차 적용과 일치 (일반 케이스)', () => {
    const a: Mat3 = [1.2, -0.3, 4, 0.7, 2.1, -5];
    const b: Mat3 = [0.5, 1.5, -2, -1.1, 0.4, 3];
    const p: Vec2 = { x: -3.7, y: 2.9 };
    expectVecClose(applyMat3(composeMat3(a, b), p), applyMat3(a, applyMat3(b, p)), 12);
  });

  it('항등과의 합성은 원본 유지', () => {
    const m = mat3FromInsert({ x: 1, y: 2 }, 2, 2, 0.3);
    expect(composeMat3(IDENTITY_MAT3, m)).toEqual(m);
    expect(composeMat3(m, IDENTITY_MAT3)).toEqual(m);
  });
});

describe('상사변환 판정·계수', () => {
  it('회전+균등 스케일은 상사변환', () => {
    const m = mat3FromInsert({ x: 3, y: 4 }, 2, 2, 0.7);
    expect(isSimilarityMat3(m)).toBe(true);
    expect(mat3UniformScale(m)).toBeCloseTo(2, 12);
    expect(mat3Rotation(m)).toBeCloseTo(0.7, 12);
    expect(mat3Determinant(m)).toBeCloseTo(4, 12);
  });

  it('비균등 스케일은 상사변환이 아니다', () => {
    expect(isSimilarityMat3(mat3FromInsert({ x: 0, y: 0 }, 2, 1, 0))).toBe(false);
  });

  it('반전(음수 스케일)은 상사변환이며 det < 0', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, -1, 1, 0);
    expect(isSimilarityMat3(m)).toBe(true);
    expect(mat3Determinant(m)).toBeLessThan(0);
  });

  it('isIdentityMat3', () => {
    expect(isIdentityMat3(IDENTITY_MAT3)).toBe(true);
    expect(isIdentityMat3(mat3Translation(0.1, 0))).toBe(false);
  });
});
