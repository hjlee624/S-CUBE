import { describe, expect, it } from 'vitest';
import { facesInRegion } from './planar-faces.ts';
import type { NEntity } from '@s-cube/schema';

function line(handle: string, ax: number, ay: number, bx: number, by: number): NEntity {
  return { kind: 'line', handle, layer: '0', a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

/** 사각형 (x,y)~(x+w,y+h) 4선 */
function rect(x: number, y: number, w: number, h: number, base: string): NEntity[] {
  return [
    line(`${base}0`, x, y, x + w, y),
    line(`${base}1`, x + w, y, x + w, y + h),
    line(`${base}2`, x + w, y + h, x, y + h),
    line(`${base}3`, x, y + h, x, y),
  ];
}

const SNAP = 0.01;
const BIG = Number.POSITIVE_INFINITY;

describe('facesInRegion (RW-28)', () => {
  it('범위 안 두 인접 사각형 → 폐합면 2개 탐지', () => {
    const segs = [...rect(0, 0, 50, 50, 'A'), ...rect(50, 0, 50, 50, 'B')];
    const region = { minX: -5, minY: -5, maxX: 105, maxY: 55 };
    const faces = facesInRegion(segs, region, SNAP, BIG);
    expect(faces).not.toBeNull();
    // 각 50×50=2500 사각형 2개(외곽 100×50=5000은 maxArea 무제한이라 포함될 수 있어 ≥2)
    const areas = (faces ?? []).map((f) => f.areaRaw).sort((a, b) => a - b);
    expect(areas.filter((a) => Math.abs(a - 2500) < 1).length).toBe(2);
  });

  it('범위 밖 중심의 면은 제외', () => {
    const segs = [...rect(0, 0, 20, 20, 'A'), ...rect(100, 100, 20, 20, 'B')];
    // 범위는 첫 사각형만 포함
    const faces = facesInRegion(segs, { minX: -5, minY: -5, maxX: 30, maxY: 30 }, SNAP, BIG);
    expect(faces).not.toBeNull();
    const areas = (faces ?? []).map((f) => f.areaRaw);
    expect(areas.some((a) => Math.abs(a - 400) < 1)).toBe(true); // 20×20 첫 사각형
    // 두번째(100,100) 사각형은 범위 밖 → 제외
    expect(faces?.every((f) => f.vertices.every((v) => v.x < 50))).toBe(true);
  });

  it('교차하는 대각선이 만든 삼각형들도 탐지(교차분할)', () => {
    const segs = [
      ...rect(0, 0, 100, 100, 'S'),
      line('D1', 0, 0, 100, 100),
      line('D2', 100, 0, 0, 100),
    ];
    const faces = facesInRegion(segs, { minX: -5, minY: -5, maxX: 105, maxY: 105 }, SNAP, 9000);
    expect(faces).not.toBeNull();
    // 4개 삼각형(각 2500)이 탐지돼야 함. 외곽 사각형(10000)은 maxArea=9000으로 제외.
    const tri = (faces ?? []).filter((f) => Math.abs(f.areaRaw - 2500) < 1);
    expect(tri.length).toBe(4);
  });

  it('maxArea 로 도곽/외곽 큰 면 제외', () => {
    const segs = rect(0, 0, 100, 100, 'F');
    // 외곽 사각형 10000 하나뿐 — maxArea 5000이면 제외 → 빈 결과
    const faces = facesInRegion(segs, { minX: -5, minY: -5, maxX: 105, maxY: 105 }, SNAP, 5000);
    expect(faces).not.toBeNull();
    expect(faces).toHaveLength(0);
  });
});
