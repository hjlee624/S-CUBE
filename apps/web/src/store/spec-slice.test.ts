/**
 * 규격 마스터 슬라이스 순수 로직 테스트 (Phase 4-A).
 *
 * 커버: upsert(중복 code 교체)·update(부분·code 충돌 방지)·remove·mergeSpecs(병합)·
 * loadPresets(프리셋 병합).
 */
import type { MaterialSpec } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { loadPresets, mergeSpecs, removeSpec, updateSpec, upsertSpec } from './spec-slice.ts';

function spec(code: string, name = code, lossRate?: number): MaterialSpec {
  return {
    code,
    workType: '토공사',
    name,
    spec: '',
    unit: '㎥',
    calcType: 'section-length',
    ...(lossRate !== undefined ? { lossRate } : {}),
  };
}

describe('upsertSpec', () => {
  it('새 code 는 append', () => {
    const next = upsertSpec([spec('A')], spec('B'));
    expect(next.map((s) => s.code)).toEqual(['A', 'B']);
  });

  it('같은 code 는 교체(중복 금지)', () => {
    const next = upsertSpec([spec('A', '원본')], spec('A', '교체'));
    expect(next).toHaveLength(1);
    expect(next[0]?.name).toBe('교체');
  });

  it('원본 배열 불변', () => {
    const list = [spec('A')];
    upsertSpec(list, spec('B'));
    expect(list).toHaveLength(1);
  });
});

describe('updateSpec', () => {
  it('해당 code 만 부분 갱신', () => {
    const next = updateSpec([spec('A'), spec('B')], 'A', { lossRate: 0.03 });
    expect(next[0]?.lossRate).toBe(0.03);
    expect(next[1]?.lossRate).toBeUndefined();
  });

  it('code 를 다른 기존 code 로 바꾸려 하면 충돌 → code 변경만 무시', () => {
    const next = updateSpec([spec('A'), spec('B')], 'A', { code: 'B', name: '바뀜' });
    // name 은 반영되지만 code 는 그대로(충돌 회피)
    expect(next[0]?.code).toBe('A');
    expect(next[0]?.name).toBe('바뀜');
  });

  it('충돌 없는 code 변경은 허용', () => {
    const next = updateSpec([spec('A')], 'A', { code: 'C' });
    expect(next[0]?.code).toBe('C');
  });
});

describe('removeSpec', () => {
  it('해당 code 만 제거', () => {
    const next = removeSpec([spec('A'), spec('B')], 'A');
    expect(next.map((s) => s.code)).toEqual(['B']);
  });
});

describe('mergeSpecs / loadPresets', () => {
  it('가져온 규격을 code 기준 병합(덮어쓰기 + 추가)', () => {
    const next = mergeSpecs([spec('A', '원본'), spec('B')], [spec('A', '가져옴'), spec('C')]);
    expect(next.map((s) => s.code)).toEqual(['A', 'B', 'C']);
    expect(next.find((s) => s.code === 'A')?.name).toBe('가져옴');
  });

  it('loadPresets 는 프리셋 전체를 병합(사연댐 프리셋 74종 이상)', () => {
    const next = loadPresets([spec('CUSTOM')]);
    // 사용자 정의는 유지되고 프리셋이 추가된다.
    expect(next.some((s) => s.code === 'CUSTOM')).toBe(true);
    expect(next.length).toBeGreaterThan(1);
  });
});
