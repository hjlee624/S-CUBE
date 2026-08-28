/**
 * 좌표 변환 스모크 테스트 — world↔screen 왕복, 앵커 줌 불변성, 화면맞춤.
 */
import { describe, expect, it } from 'vitest';
import {
  type CanvasSize,
  fitBoundsViewport,
  panByScreenDelta,
  screenToWorld,
  type Viewport,
  viewportWorldBounds,
  worldToScreen,
  zoomAtScreenPoint,
} from './transform.ts';

const size: CanvasSize = { width: 800, height: 600 };

describe('world ↔ screen 변환', () => {
  it('왕복 변환이 원점으로 돌아온다', () => {
    const vp: Viewport = { center: { x: 123.456, y: -78.9 }, pxPerUnit: 2.5 };
    const world = { x: 1000.125, y: -2345.75 };
    const back = screenToWorld(worldToScreen(world, vp, size), vp, size);
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });

  it('뷰포트 center는 캔버스 중앙에 온다', () => {
    const vp: Viewport = { center: { x: 50, y: 60 }, pxPerUnit: 3 };
    const s = worldToScreen(vp.center, vp, size);
    expect(s.x).toBeCloseTo(size.width / 2);
    expect(s.y).toBeCloseTo(size.height / 2);
  });

  it('y축은 반전된다 (world 위쪽 = screen 위쪽)', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 1 };
    const above = worldToScreen({ x: 0, y: 10 }, vp, size);
    const below = worldToScreen({ x: 0, y: -10 }, vp, size);
    expect(above.y).toBeLessThan(below.y);
  });
});

describe('팬/줌', () => {
  it('팬: 화면 delta만큼 world center가 반대로 이동한다', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 2 };
    const panned = panByScreenDelta(vp, 100, -50);
    expect(panned.center.x).toBeCloseTo(-50); // 오른쪽 드래그 → 왼쪽 내용 보임
    expect(panned.center.y).toBeCloseTo(-25);
    expect(panned.pxPerUnit).toBe(vp.pxPerUnit);
  });

  it('앵커 줌: 커서 아래 world 좌표가 줌 후에도 같은 화면 px에 남는다', () => {
    const vp: Viewport = { center: { x: 10, y: 20 }, pxPerUnit: 1.5 };
    const anchor = { x: 200, y: 450 };
    const before = screenToWorld(anchor, vp, size);
    const zoomed = zoomAtScreenPoint(vp, anchor, 1.8, size);
    const after = worldToScreen(before, zoomed, size);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
    expect(zoomed.pxPerUnit).toBeCloseTo(1.5 * 1.8);
  });
});

describe('fitBoundsViewport (Zoom Extents)', () => {
  it('bounds 네 모서리가 모두 화면 안에 들어온다', () => {
    const bounds = { minX: -120, minY: 40, maxX: 380, maxY: 90 };
    const vp = fitBoundsViewport(bounds, size, 40);
    for (const corner of [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY },
    ]) {
      const s = worldToScreen(corner, vp, size);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(size.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(size.height);
    }
  });

  it('영벡터(점) bounds도 유한한 뷰포트를 만든다', () => {
    const vp = fitBoundsViewport({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, size);
    expect(Number.isFinite(vp.pxPerUnit)).toBe(true);
    expect(vp.pxPerUnit).toBeGreaterThan(0);
    expect(vp.center).toEqual({ x: 5, y: 5 });
  });
});

describe('viewportWorldBounds', () => {
  it('화면 전체를 커버하는 world 영역을 돌려준다', () => {
    const vp: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 2 };
    const b = viewportWorldBounds(vp, size);
    expect(b.maxX - b.minX).toBeCloseTo(size.width / 2);
    expect(b.maxY - b.minY).toBeCloseTo(size.height / 2);
  });
});
