import type { Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { detectDuplicates, sortSections } from './sort.ts';

function station(
  chainage_m: number,
  discontinuity: 'pre' | 'post' | null = null,
  no = 0,
  plus_m = chainage_m,
): Station {
  return { raw: `No.${no}+${plus_m}`, no, plus_m, chainage_m, discontinuity };
}

function section(
  id: string,
  chainage_m: number,
  itemKey = '절토',
  discontinuity: 'pre' | 'post' | null = null,
  area_m2 = 10,
): StationSection {
  return { id, station: station(chainage_m, discontinuity), itemKey, area_m2 };
}

describe('sortSections — chainage 오름차순', () => {
  it('chainage 오름차순 정렬', () => {
    const input = [section('c', 40), section('a', 0), section('b', 20)];
    const sorted = sortSections(input);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('입력 배열을 변경하지 않는다 (순수)', () => {
    const input = [section('c', 40), section('a', 0)];
    const before = input.map((s) => s.id);
    sortSections(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });

  it('동일 chainage 는 pre → null → post 순', () => {
    const input = [
      section('post', 160, '절토', 'post'),
      section('null', 160, '절토', null),
      section('pre', 160, '절토', 'pre'),
    ];
    const sorted = sortSections(input);
    expect(sorted.map((s) => s.id)).toEqual(['pre', 'null', 'post']);
  });

  it('동일 chainage·동일 discontinuity 는 입력 순서 보존 (안정 정렬)', () => {
    const input = [section('x', 160, '절토', null), section('y', 160, '성토', null)];
    const sorted = sortSections(input);
    expect(sorted.map((s) => s.id)).toEqual(['x', 'y']);
  });
});

describe('detectDuplicates — 중복 검출 (P3-3)', () => {
  it('동일 chainage+itemKey+discontinuity 2개 이상 → 중복', () => {
    const input = [
      section('a', 160, '절토', null),
      section('b', 160, '절토', null),
      section('c', 160, '성토', null),
    ];
    const dups = detectDuplicates(input);
    expect(dups).toHaveLength(1);
    expect(dups[0]?.sections.map((s) => s.id)).toEqual(['a', 'b']);
    expect(dups[0]?.itemKey).toBe('절토');
  });

  it('discontinuity 가 다르면 중복 아님 (pre 와 post 는 별개)', () => {
    const input = [section('a', 160, '절토', 'pre'), section('b', 160, '절토', 'post')];
    expect(detectDuplicates(input)).toHaveLength(0);
  });

  it('중복 없으면 빈 배열', () => {
    const input = [section('a', 0), section('b', 20), section('c', 40)];
    expect(detectDuplicates(input)).toEqual([]);
  });
});
