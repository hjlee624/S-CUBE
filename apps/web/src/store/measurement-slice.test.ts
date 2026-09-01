/**
 * 측정 슬라이스 순수 로직 테스트 — 추가·삭제·라벨수정·도면별 제거·선택 토글 (순수 함수).
 */
import type { Measurement } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  addMeasurement,
  clearForDrawing,
  recomputeValuesForDrawing,
  removeMeasurement,
  toggleSelection,
  updateLabel,
} from './measurement-slice.ts';

function m(id: string, drawingId: string, label = 't'): Measurement {
  return {
    id,
    drawingId,
    kind: 'area',
    value: 1,
    rawValue: 1,
    method: 'polyline',
    sourceHandles: [id],
    label,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

/** kind/rawValue/value 를 지정한 측정 팩토리 — 재계산 검증용 */
function mk(
  id: string,
  drawingId: string,
  kind: Measurement['kind'],
  rawValue: number,
  value: number,
): Measurement {
  return {
    id,
    drawingId,
    kind,
    value,
    rawValue,
    method: 'polyline',
    sourceHandles: [id],
    label: id,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('addMeasurement', () => {
  it('배열 끝에 추가하고 원본은 불변', () => {
    const list = [m('a', 'd1')];
    const next = addMeasurement(list, m('b', 'd1'));
    expect(next.map((x) => x.id)).toEqual(['a', 'b']);
    expect(list).toHaveLength(1); // 불변
  });
});

describe('removeMeasurement', () => {
  it('해당 id만 제거', () => {
    const list = [m('a', 'd1'), m('b', 'd1'), m('c', 'd1')];
    expect(removeMeasurement(list, 'b').map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('없는 id면 변화 없음', () => {
    const list = [m('a', 'd1')];
    expect(removeMeasurement(list, 'zzz').map((x) => x.id)).toEqual(['a']);
  });
});

describe('updateLabel', () => {
  it('해당 id의 라벨만 교체', () => {
    const list = [m('a', 'd1', '옛이름'), m('b', 'd1', 'x')];
    const next = updateLabel(list, 'a', '절토부');
    expect(next.find((x) => x.id === 'a')?.label).toBe('절토부');
    expect(next.find((x) => x.id === 'b')?.label).toBe('x');
  });
});

describe('clearForDrawing — 도면별 제거', () => {
  it('해당 drawingId 측정만 제거, 다른 도면은 보존', () => {
    const list = [m('a', 'd1'), m('b', 'd2'), m('c', 'd1'), m('d', 'd2')];
    const next = clearForDrawing(list, 'd1');
    expect(next.map((x) => x.id)).toEqual(['b', 'd']);
    expect(next.every((x) => x.drawingId === 'd2')).toBe(true);
  });
});

describe('recomputeValuesForDrawing — 재캘리브레이션 value 되계산', () => {
  it('면적은 scale², 연장은 scale 로 rawValue 에서 되계산', () => {
    // 최초 축척 1 로 측정됐다고 가정(value=rawValue). 새 축척 2 로 되계산.
    const list = [
      mk('a', 'd1', 'area', 100, 100), // area: 100 × 2² = 400
      mk('b', 'd1', 'length', 50, 50), // length: 50 × 2 = 100
    ];
    const next = recomputeValuesForDrawing(list, 'd1', 2);
    expect(next.find((x) => x.id === 'a')?.value).toBeCloseTo(400, 12);
    expect(next.find((x) => x.id === 'b')?.value).toBeCloseTo(100, 12);
    // rawValue 는 보존(역산 기준) 되어야 한다.
    expect(next.find((x) => x.id === 'a')?.rawValue).toBe(100);
    expect(next.find((x) => x.id === 'b')?.rawValue).toBe(50);
  });

  it('다른 도면(drawingId 불일치) 측정은 건드리지 않는다', () => {
    const list = [mk('a', 'd1', 'area', 100, 100), mk('z', 'd2', 'area', 100, 100)];
    const next = recomputeValuesForDrawing(list, 'd1', 3);
    expect(next.find((x) => x.id === 'a')?.value).toBeCloseTo(900, 12); // 100 × 3²
    expect(next.find((x) => x.id === 'z')?.value).toBe(100); // d2 는 그대로
  });

  it('되계산은 이전 value 를 무시하고 rawValue 로 되풀어 옛/새 축척 혼재를 막는다', () => {
    // 옛 축척 2 로 얼린 value(=400)가 있어도, 새 축척 5 되계산은 rawValue(100)에서 다시 낸다.
    const list = [mk('a', 'd1', 'area', 100, 400)];
    const next = recomputeValuesForDrawing(list, 'd1', 5);
    expect(next.find((x) => x.id === 'a')?.value).toBeCloseTo(2500, 12); // 100 × 5²
  });

  it('원본 배열은 불변', () => {
    const list = [mk('a', 'd1', 'area', 100, 100)];
    recomputeValuesForDrawing(list, 'd1', 2);
    expect(list[0]?.value).toBe(100);
  });
});

describe('toggleSelection — Shift 다중선택', () => {
  it('없으면 추가', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('있으면 제거', () => {
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('빈 선택에서 추가', () => {
    expect(toggleSelection([], 'a')).toEqual(['a']);
  });
});
