import { describe, expect, it } from 'vitest';
import { splitAtIntersections } from './intersect-split.ts';
import type { NEntity } from '@s-cube/schema';

function line(handle: string, ax: number, ay: number, bx: number, by: number): NEntity {
  return { kind: 'line', handle, layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

describe('splitAtIntersections (RW-26)', () => {
  it('교차하는 두 선 → 각각 교차점에서 2분할(총 4선)', () => {
    // + 모양: 수평선과 수직선이 (0,0)에서 교차
    const out = splitAtIntersections([line('H', -10, 0, 10, 0), line('V', 0, -10, 0, 10)]);
    expect(out).toHaveLength(4);
    // 모든 조각이 원본 handle 보존
    const handles = new Set(out.map((e) => e.handle));
    expect(handles).toEqual(new Set(['H', 'V']));
  });

  it('교차 없는 선 → 그대로', () => {
    const out = splitAtIntersections([line('A', 0, 0, 10, 0), line('B', 0, 5, 10, 5)]);
    expect(out).toHaveLength(2);
  });

  it('끝점만 닿는 선(T자 꼭짓점)은 분할하지 않음(내부 교차만)', () => {
    // B 의 끝점이 A 의 끝점에 닿음 — 내부 교차 아님
    const out = splitAtIntersections([line('A', 0, 0, 10, 0), line('B', 10, 0, 10, 10)]);
    expect(out).toHaveLength(2);
  });

  it('같은 handle(같은 엔티티) 세그먼트끼리는 교차분할 제외', () => {
    // 자기 자신 교차하는 폴리라인은 분할하지 않음(끝점 공유가 정상)
    const poly: NEntity = {
      kind: 'polyline',
      handle: 'P',
      layer: '0',
      closed: false,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: 10, y: 10 }, bulge: 0 },
      ],
    };
    const out = splitAtIntersections([poly]);
    expect(out).toHaveLength(1);
  });
});
