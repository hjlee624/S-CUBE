/**
 * localStorage 키 생성 테스트 (P1-13) — 순수 함수만 검증 (jsdom 불필요).
 */
import { describe, expect, it } from 'vitest';
import { calibrationStorageKey, fnv1aHash } from './storage.ts';

const bounds = { minX: -10.5, minY: 0, maxX: 250.25, maxY: 99.999 };

describe('fnv1aHash', () => {
  it('결정적이고 8자리 hex를 낸다', () => {
    expect(fnv1aHash('s-cube')).toBe(fnv1aHash('s-cube'));
    expect(fnv1aHash('s-cube')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('입력이 다르면 해시가 다르다', () => {
    expect(fnv1aHash('a.dxf')).not.toBe(fnv1aHash('b.dxf'));
  });
});

describe('calibrationStorageKey', () => {
  it('같은 (파일명, 엔티티수, bounds) → 같은 키', () => {
    const a = calibrationStorageKey('road.dxf', 1234, bounds);
    const b = calibrationStorageKey('road.dxf', 1234, { ...bounds });
    expect(a).toBe(b);
    expect(a.startsWith('s-cube:cal:v1:')).toBe(true);
  });

  it('파일명·엔티티수·bounds가 다르면 키가 달라진다', () => {
    const base = calibrationStorageKey('road.dxf', 1234, bounds);
    expect(calibrationStorageKey('dam.dxf', 1234, bounds)).not.toBe(base);
    expect(calibrationStorageKey('road.dxf', 1235, bounds)).not.toBe(base);
    expect(calibrationStorageKey('road.dxf', 1234, { ...bounds, maxX: bounds.maxX + 1 })).not.toBe(
      base,
    );
  });

  it('bounds 부동소수 미세 오차(유효숫자 9자리 이하)는 같은 키로 흡수한다', () => {
    const a = calibrationStorageKey('road.dxf', 10, bounds);
    const b = calibrationStorageKey('road.dxf', 10, {
      ...bounds,
      maxX: bounds.maxX + 1e-12,
    });
    expect(a).toBe(b);
  });

  it('bounds null(빈 도면)도 안정적인 키를 만든다', () => {
    expect(calibrationStorageKey('empty.dxf', 0, null)).toBe(
      calibrationStorageKey('empty.dxf', 0, null),
    );
  });
});
