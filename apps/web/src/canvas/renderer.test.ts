/**
 * 치수 근사 렌더 생략 판정(dimensionHasPicture) 순수 로직 테스트.
 *
 * 계약: 치수블록이 전개된 치수(hasPicture===true)는 실제 line/polyline/text 로 그려지므로
 * 렌더러가 정의점 근사(파선+틱)를 그리지 않는다(이중 그리기 방지). 블록 없는 치수는 근사 유지.
 * core가 NDimension.hasPicture?: boolean 을 병렬 추가 중이라 스키마 타입에 아직 없을 수 있어
 * 구조적 옵션 접근을 쓰며, 이 테스트는 그 접근이 필드 유무와 무관히 올바른지 검증한다.
 */
import type { NDimension, NEntity, NLine } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { dimensionHasPicture } from './renderer.ts';

const baseDim: NDimension = {
  kind: 'dimension',
  handle: 'D1',
  layer: '0',
  defPoints: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  measuredRaw: 10,
  textOverride: null,
};

describe('dimensionHasPicture', () => {
  it('hasPicture===true 치수는 근사 렌더 생략(true)', () => {
    // core가 필드를 추가한 뒤의 형태 — 구조적으로 hasPicture 를 부여
    const dim = { ...baseDim, hasPicture: true } as NEntity;
    expect(dimensionHasPicture(dim)).toBe(true);
  });

  it('hasPicture 미설정 치수는 근사 유지(false) — 무회귀', () => {
    expect(dimensionHasPicture(baseDim)).toBe(false);
  });

  it('hasPicture===false 치수는 근사 유지(false)', () => {
    const dim = { ...baseDim, hasPicture: false } as NEntity;
    expect(dimensionHasPicture(dim)).toBe(false);
  });

  it('치수가 아닌 엔티티는 항상 false (다른 렌더 경로 훼손 금지)', () => {
    const line: NLine = {
      kind: 'line',
      handle: 'L1',
      layer: '0',
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
    };
    expect(dimensionHasPicture(line)).toBe(false);
    // 전개된 블록 텍스트(치수값)도 text 엔티티라 이 게이트에 걸리지 않음
    const text = {
      kind: 'text',
      handle: 'T1',
      layer: '0',
      pos: { x: 0, y: 0 },
      value: 'R1.000',
      height: 2.5,
    } as NEntity;
    expect(dimensionHasPicture(text)).toBe(false);
  });
});
