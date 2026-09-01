import { describe, expect, it } from 'vitest';
import {
  CellMap,
  columnLetter,
  itemQuantityKey,
  measurementValueKey,
  sectionAreaKey,
  segmentKey,
  sheetRef,
} from './cell-map.ts';

describe('논리 키 규약', () => {
  it('section/segment/measurement/item 키 형태', () => {
    expect(sectionAreaKey('ss-1')).toBe('section:ss-1:area');
    expect(segmentKey('a~b', 'volume')).toBe('segment:a~b:volume');
    expect(segmentKey('a~b', 'length')).toBe('segment:a~b:length');
    expect(measurementValueKey('m-1')).toBe('measurement:m-1:value');
    expect(itemQuantityKey('ti-1')).toBe('item:ti-1:quantity');
  });
});

describe('CellMap', () => {
  it('등록 후 조회', () => {
    const cells = new CellMap();
    cells.set('section:ss-1:area', '상세!C2');
    expect(cells.get('section:ss-1:area')).toBe('상세!C2');
    expect(cells.size).toBe(1);
  });

  it('중복 등록은 에러', () => {
    const cells = new CellMap();
    cells.set('k', 'A1');
    expect(() => cells.set('k', 'A2')).toThrow(/중복/);
  });

  it('resolver 는 미등록 키에 에러로 승격', () => {
    const cells = new CellMap();
    cells.set('k', 'A1');
    const resolve = cells.resolver();
    expect(resolve('k')).toBe('A1');
    expect(() => resolve('nope')).toThrow(/찾을 수 없습니다/);
  });
});

describe('sheetRef', () => {
  it('한글·공백 시트명은 작은따옴표로 인용', () => {
    expect(sheetRef('측점별 상세', 'D12')).toBe("'측점별 상세'!D12");
  });

  it('ASCII 단순 시트명은 인용 없음', () => {
    expect(sheetRef('Detail', 'D12')).toBe('Detail!D12');
  });

  it('따옴표 포함 시트명은 이스케이프', () => {
    expect(sheetRef("A'B", 'D1')).toBe("'A''B'!D1");
  });
});

describe('columnLetter', () => {
  it('0→A, 25→Z, 26→AA, 27→AB', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
  });

  it('음수·비정수는 에러', () => {
    expect(() => columnLetter(-1)).toThrow();
    expect(() => columnLetter(1.5)).toThrow();
  });
});
