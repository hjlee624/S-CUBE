import { describe, expect, it } from 'vitest';
import { boundaryAtPoint } from './boundary-at-point.ts';
import type { NEntity } from '@s-cube/schema';

/** 4개 LINE 으로 사각형(x,y)~(x+w,y+h) */
function rect(x: number, y: number, w: number, h: number, base = 'R'): NEntity[] {
  return [
    { kind: 'line', handle: `${base}0`, layer: '0', a: { x, y }, b: { x: x + w, y } },
    { kind: 'line', handle: `${base}1`, layer: '0', a: { x: x + w, y }, b: { x: x + w, y: y + h } },
    { kind: 'line', handle: `${base}2`, layer: '0', a: { x: x + w, y: y + h }, b: { x, y: y + h } },
    { kind: 'line', handle: `${base}3`, layer: '0', a: { x, y: y + h }, b: { x, y } },
  ];
}

const SNAP = 0.01;

describe('boundaryAtPoint (RW-25)', () => {
  it('사각형 내부 점 → 그 사각형 경계·면적 반환', () => {
    const face = boundaryAtPoint(rect(0, 0, 100, 50), { x: 50, y: 25 }, SNAP);
    expect(face).not.toBeNull();
    expect(face?.areaRaw).toBeCloseTo(5000, 3);
    expect(face?.handles).toEqual(expect.arrayContaining(['R0', 'R1', 'R2', 'R3']));
  });

  it('사각형 외부 점 → null', () => {
    const face = boundaryAtPoint(rect(0, 0, 100, 50), { x: 200, y: 200 }, SNAP);
    expect(face).toBeNull();
  });

  it('겹친 사각형 2개 — 내부 점을 감싸는 최소 영역을 고른다', () => {
    // 큰 사각형(0,0,100,100) + 작은 사각형(10,10,20,20). 점(20,20)은 둘 다 안이나 작은 쪽이 최소.
    const segs = [...rect(0, 0, 100, 100, 'B'), ...rect(10, 10, 20, 20, 'S')];
    const face = boundaryAtPoint(segs, { x: 20, y: 20 }, SNAP);
    expect(face).not.toBeNull();
    expect(face?.areaRaw).toBeCloseTo(400, 3); // 20×20 작은 사각형
  });

  it('열린 영역(끊긴 선) → null', () => {
    // 사각형에서 한 변 제거 → 폐합 안 됨
    const open = rect(0, 0, 100, 50).slice(0, 3);
    const face = boundaryAtPoint(open, { x: 50, y: 25 }, SNAP);
    expect(face).toBeNull();
  });

  it('세그먼트 3개 미만 → null', () => {
    const segs: NEntity[] = [
      { kind: 'line', handle: 'L', layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    ];
    expect(boundaryAtPoint(segs, { x: 5, y: 0 }, SNAP)).toBeNull();
  });

  it('maxArea 초과 face(외곽 프레임)는 무시하고 내부 작은 영역을 고른다', () => {
    // 큰 프레임(0,0,200,100)=20000 + 작은 방(80,40,40,20)=800. 점(100,50)은 둘 다 안.
    const segs = [...rect(0, 0, 200, 100, 'F'), ...rect(80, 40, 40, 20, 'R')];
    // maxArea=5000 → 프레임(20000) 무시, 작은 방(800) 반환.
    const face = boundaryAtPoint(segs, { x: 100, y: 50 }, SNAP, 5000);
    expect(face?.areaRaw).toBeCloseTo(800, 3);
    // maxArea 없으면 최소 영역(역시 작은 방)이지만, 프레임만 있는 경우엔 무시로 null 이 되는지 별도 확인.
    const frameOnly = boundaryAtPoint(rect(0, 0, 200, 100, 'F'), { x: 100, y: 50 }, SNAP, 5000);
    expect(frameOnly).toBeNull();
  });

  it('polyline 폐합 경계도 인식', () => {
    const segs: NEntity[] = [
      {
        kind: 'polyline',
        handle: 'P0',
        layer: '0',
        closed: true,
        vertices: [
          { p: { x: 0, y: 0 }, bulge: 0 },
          { p: { x: 40, y: 0 }, bulge: 0 },
          { p: { x: 40, y: 30 }, bulge: 0 },
          { p: { x: 0, y: 30 }, bulge: 0 },
        ],
      },
    ];
    const face = boundaryAtPoint(segs, { x: 20, y: 15 }, SNAP);
    expect(face).not.toBeNull();
    expect(face?.areaRaw).toBeCloseTo(1200, 3);
  });
});
