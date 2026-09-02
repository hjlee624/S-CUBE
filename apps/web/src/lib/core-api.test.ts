/**
 * core 계약 어댑터 순수 로직 — 진단 필드 정규화 (fetch·DOM 불필요).
 *
 * orphanedBlockCount: DWG 변환이 배치 INSERT를 잃어 렌더 못 하는 설계 객체 규모.
 * 어댑터가 "> 0만 표시" 계약을 지키도록 비정상값(없음·NaN·Infinity·음수·비수치)을
 * 0으로 정규화하는지 검증한다.
 */
import type { DrawingModel } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { orphanedBlockCount } from './core-api.ts';

/** 최소 DrawingModel 스텁 — 어댑터는 진단 필드만 참조하므로 형태만 맞춘다.
 *  런타임 정규화를 검증하려고 orphanedBlockCount에 계약 위반 값을 주입한다
 *  (실제 core는 number를 보장하지만, 방어 정규화가 계약이다 → unknown 경유 주입). */
function model(overrides: Record<string, unknown> = {}): DrawingModel {
  const base: DrawingModel = {
    dxfVersion: 'AC1015',
    insUnits: 6,
    layers: [],
    entities: [],
    unsupportedCounts: {},
    sanitizedCount: 0,
    paperSpaceExcludedCount: 0,
    orphanedBlockCount: 0,
    bounds: null,
  };
  return { ...base, ...overrides } as unknown as DrawingModel;
}

describe('orphanedBlockCount', () => {
  it('양의 정수를 그대로 통과시킨다 (경고 표시 대상)', () => {
    expect(orphanedBlockCount(model({ orphanedBlockCount: 62 }))).toBe(62);
    expect(orphanedBlockCount(model({ orphanedBlockCount: 1 }))).toBe(1);
  });

  it('기본(고아 없음)은 0을 반환한다', () => {
    expect(orphanedBlockCount(model())).toBe(0);
  });

  it('0·음수는 0으로 정규화한다 (표시 안 함)', () => {
    expect(orphanedBlockCount(model({ orphanedBlockCount: 0 }))).toBe(0);
    expect(orphanedBlockCount(model({ orphanedBlockCount: -5 }))).toBe(0);
  });

  it('비정상 수치(NaN·Infinity)는 0으로 정규화한다', () => {
    expect(orphanedBlockCount(model({ orphanedBlockCount: Number.NaN }))).toBe(0);
    expect(orphanedBlockCount(model({ orphanedBlockCount: Number.POSITIVE_INFINITY }))).toBe(0);
  });

  it('비수치 타입(문자열·null·undefined)은 0으로 정규화한다', () => {
    expect(orphanedBlockCount(model({ orphanedBlockCount: '62' }))).toBe(0);
    expect(orphanedBlockCount(model({ orphanedBlockCount: null }))).toBe(0);
    expect(orphanedBlockCount(model({ orphanedBlockCount: undefined }))).toBe(0);
  });
});
