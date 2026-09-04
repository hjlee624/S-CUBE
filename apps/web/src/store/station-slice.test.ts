/**
 * 측점 슬라이스 순수 로직 테스트 (Phase 3-C).
 *
 * 커버: 단면 추가·삭제·단면적 수정(측정 연결 해제)·측정 할당(P3-12)·항목 추가/이름변경·raw 재파싱.
 */
import type { Station, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  accumulateSectionArea,
  addItemKey,
  addSection,
  assignMeasurement,
  removeSection,
  renameItemKey,
  updateSectionArea,
  updateSectionRaw,
} from './station-slice.ts';

function station(raw: string, chainage_m: number): Station {
  return { raw, no: 0, plus_m: 0, chainage_m, discontinuity: null };
}

function sec(id: string, itemKey: string, area_m2: number, measurementId?: string): StationSection {
  return {
    id,
    station: station(`No.0+${chainageFromId(id)}`, chainageFromId(id)),
    itemKey,
    area_m2,
    ...(measurementId !== undefined ? { measurementId } : {}),
  };
}

function chainageFromId(id: string): number {
  return id.charCodeAt(0);
}

describe('addSection / removeSection', () => {
  it('배열 끝에 추가하고 원본 불변', () => {
    const list = [sec('a', '절토', 10)];
    const next = addSection(list, sec('b', '절토', 20));
    expect(next.map((s) => s.id)).toEqual(['a', 'b']);
    expect(list).toHaveLength(1);
  });

  it('해당 id 만 제거', () => {
    const list = [sec('a', '절토', 10), sec('b', '절토', 20)];
    expect(removeSection(list, 'a').map((s) => s.id)).toEqual(['b']);
  });
});

describe('accumulateSectionArea — 도면 면적 취득 누적 (RW-22)', () => {
  const st = (raw: string, disc: 'pre' | 'post' | null = null): Station => ({
    raw,
    no: 0,
    plus_m: 0,
    chainage_m: 0,
    discontinuity: disc,
  });
  const mk = (
    id: string,
    itemKey: string,
    area_m2: number,
    raw: string,
    extra: Partial<StationSection> = {},
  ): StationSection => ({ id, station: st(raw), itemKey, area_m2, ...extra });

  it('대상 셀 없으면 새 단면 생성 (sourceMeasurementIds=[m])', () => {
    const r = accumulateSectionArea([], {
      station: st('No.8'),
      itemKey: '절토',
      addValue: 12,
      measurementId: 'm1',
      additive: false,
      newSectionId: 'new',
    });
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]).toMatchObject({
      id: 'new',
      itemKey: '절토',
      area_m2: 12,
      measurementId: 'm1',
      sourceMeasurementIds: ['m1'],
    });
    expect(r.total_m2).toBe(12);
    expect(r.sourceCount).toBe(1);
  });

  it('additive=false → 기존 셀 값 교체(출처 초기화)', () => {
    const list = [mk('s1', '절토', 10, 'No.8', { measurementId: 'old', sourceMeasurementIds: ['old'] })];
    const r = accumulateSectionArea(list, {
      station: st('No.8'),
      itemKey: '절토',
      addValue: 7,
      measurementId: 'm2',
      additive: false,
      newSectionId: 'x',
    });
    expect(r.sections[0]?.area_m2).toBe(7);
    expect(r.sections[0]?.sourceMeasurementIds).toEqual(['m2']);
    expect(r.sourceCount).toBe(1);
  });

  it('additive=true → 기존 값에 합산 + 출처 append', () => {
    const list = [mk('s1', '절토', 10, 'No.8', { measurementId: 'old', sourceMeasurementIds: ['old'] })];
    const r = accumulateSectionArea(list, {
      station: st('No.8'),
      itemKey: '절토',
      addValue: 5,
      measurementId: 'm2',
      additive: true,
      newSectionId: 'x',
    });
    expect(r.sections[0]?.area_m2).toBe(15);
    expect(r.sections[0]?.sourceMeasurementIds).toEqual(['old', 'm2']);
    expect(r.total_m2).toBe(15);
    expect(r.sourceCount).toBe(2);
  });

  it('additive=true 이고 기존이 단일 measurementId(구형) → [old,new]로 승격', () => {
    const list = [mk('s1', '절토', 8, 'No.8', { measurementId: 'old' })];
    const r = accumulateSectionArea(list, {
      station: st('No.8'),
      itemKey: '절토',
      addValue: 2,
      measurementId: 'm2',
      additive: true,
      newSectionId: 'x',
    });
    expect(r.sections[0]?.area_m2).toBe(10);
    expect(r.sections[0]?.sourceMeasurementIds).toEqual(['old', 'm2']);
  });

  it('같은 raw 라도 itemKey 다르면 별도 셀 생성', () => {
    const list = [mk('s1', '절토', 10, 'No.8', { measurementId: 'old' })];
    const r = accumulateSectionArea(list, {
      station: st('No.8'),
      itemKey: '성토',
      addValue: 4,
      measurementId: 'm2',
      additive: true,
      newSectionId: 'new',
    });
    expect(r.sections).toHaveLength(2);
    expect(r.sections[1]).toMatchObject({ itemKey: '성토', area_m2: 4 });
  });

  it('discontinuity 다르면 별도 셀 (전/후 구분)', () => {
    const list = [mk('s1', '절토', 10, 'No.8', {})];
    // 위 mk 는 discontinuity=null. post 로 취득하면 다른 셀이어야 한다.
    const r = accumulateSectionArea(list, {
      station: st('No.8', 'post'),
      itemKey: '절토',
      addValue: 3,
      measurementId: 'm2',
      additive: true,
      newSectionId: 'new',
    });
    expect(r.sections).toHaveLength(2);
  });

  it('원본 배열 불변', () => {
    const list = [mk('s1', '절토', 10, 'No.8', {})];
    accumulateSectionArea(list, {
      station: st('No.8'),
      itemKey: '절토',
      addValue: 5,
      measurementId: 'm2',
      additive: true,
      newSectionId: 'x',
    });
    expect(list[0]?.area_m2).toBe(10);
  });
});

describe('updateSectionArea — 수동 수정은 측정 연결을 끊는다', () => {
  it('area_m2 를 교체하고 measurementId 를 제거한다', () => {
    const list = [sec('a', '절토', 10, 'meas-1')];
    const next = updateSectionArea(list, 'a', 42);
    expect(next[0]?.area_m2).toBe(42);
    expect(next[0]?.measurementId).toBeUndefined();
  });

  it('다른 단면은 건드리지 않는다', () => {
    const list = [sec('a', '절토', 10), sec('b', '절토', 20)];
    const next = updateSectionArea(list, 'a', 99);
    expect(next[1]?.area_m2).toBe(20);
  });
});

describe('assignMeasurement — 측정값 셀 할당 (P3-12)', () => {
  it('area_m2 와 measurementId 를 함께 설정한다', () => {
    const list = [sec('a', '절토', 0)];
    const next = assignMeasurement(list, 'a', 'meas-9', 123.456);
    expect(next[0]?.area_m2).toBeCloseTo(123.456, 9);
    expect(next[0]?.measurementId).toBe('meas-9');
  });

  it('측정값 할당 후 수동 수정하면 다시 연결이 끊긴다 (수동 우선)', () => {
    const assigned = assignMeasurement([sec('a', '절토', 0)], 'a', 'meas-9', 100);
    const edited = updateSectionArea(assigned, 'a', 55);
    expect(edited[0]?.area_m2).toBe(55);
    expect(edited[0]?.measurementId).toBeUndefined();
  });
});

describe('updateSectionRaw — raw 재파싱', () => {
  it('유효한 표기면 station(chainage 포함)을 갱신', () => {
    const list = [sec('a', '절토', 10)];
    const next = updateSectionRaw(list, 'a', 'No.3+0.000', 20);
    expect(next[0]?.station.chainage_m).toBe(60);
    expect(next[0]?.station.raw).toBe('No.3+0.000');
  });

  it('파싱 실패면 raw 만 반영해 테이블에서 에러로 드러나게 한다', () => {
    const list = [sec('a', '절토', 10)];
    const prevChainage = list[0]?.station.chainage_m;
    const next = updateSectionRaw(list, 'a', '엉터리', 20);
    expect(next[0]?.station.raw).toBe('엉터리');
    // chainage 는 이전 값 유지 (표시는 파싱 재검사로 에러 배지가 갈림)
    expect(next[0]?.station.chainage_m).toBe(prevChainage);
  });

  it('불연속 (전) 표기를 재파싱해 discontinuity 를 설정', () => {
    const list = [sec('a', '절토', 10)];
    const next = updateSectionRaw(list, 'a', 'No.8+0.000(전)', 20);
    expect(next[0]?.station.discontinuity).toBe('pre');
  });
});

describe('addItemKey', () => {
  it('새 항목 추가', () => {
    expect(addItemKey(['절토'], '성토')).toEqual(['절토', '성토']);
  });

  it('중복·공백은 무시', () => {
    expect(addItemKey(['절토'], '절토')).toEqual(['절토']);
    expect(addItemKey(['절토'], '   ')).toEqual(['절토']);
  });
});

describe('renameItemKey — 항목 이름 변경', () => {
  it('키 목록과 해당 단면들의 itemKey 를 함께 바꾼다', () => {
    const keys = ['절토', '성토'];
    const sections = [sec('a', '절토', 10), sec('b', '성토', 5)];
    const res = renameItemKey(keys, sections, '절토', '암깎기');
    expect(res.itemKeys).toEqual(['암깎기', '성토']);
    expect(res.sections.find((s) => s.id === 'a')?.itemKey).toBe('암깎기');
    expect(res.sections.find((s) => s.id === 'b')?.itemKey).toBe('성토');
  });

  it('대상 이름이 기존 키와 겹치면 변경하지 않는다', () => {
    const res = renameItemKey(['절토', '성토'], [], '절토', '성토');
    expect(res.itemKeys).toEqual(['절토', '성토']);
  });
});
