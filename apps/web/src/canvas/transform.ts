/**
 * world(도면 좌표, y 위쪽) ↔ screen(CSS px, y 아래쪽) 변환 — 순수 모듈.
 *
 * 뷰포트 정의: 캔버스 중앙에 오는 world 좌표(center) + 확대율(pxPerUnit).
 * screen.x = (w.x - center.x) · pxPerUnit + width/2
 * screen.y = (center.y - w.y) · pxPerUnit + height/2   (y 반전)
 */
import type { Bounds, Vec2 } from '@s-cube/schema';

/** 뷰포트 상태 — Zustand viewport 슬라이스가 보관 */
export interface Viewport {
  /** 캔버스 중앙에 표시되는 world 좌표 */
  center: Vec2;
  /** 1 도면단위가 차지하는 CSS px 수 */
  pxPerUnit: number;
}

/** 캔버스 CSS 크기 (px) */
export interface CanvasSize {
  width: number;
  height: number;
}

export function worldToScreen(p: Vec2, vp: Viewport, size: CanvasSize): Vec2 {
  return {
    x: (p.x - vp.center.x) * vp.pxPerUnit + size.width / 2,
    y: (vp.center.y - p.y) * vp.pxPerUnit + size.height / 2,
  };
}

export function screenToWorld(s: Vec2, vp: Viewport, size: CanvasSize): Vec2 {
  return {
    x: (s.x - size.width / 2) / vp.pxPerUnit + vp.center.x,
    y: vp.center.y - (s.y - size.height / 2) / vp.pxPerUnit,
  };
}

/** 화면 px 이동량(드래그 delta) → 새 뷰포트 (팬) */
export function panByScreenDelta(vp: Viewport, dx_px: number, dy_px: number): Viewport {
  return {
    center: {
      x: vp.center.x - dx_px / vp.pxPerUnit,
      y: vp.center.y + dy_px / vp.pxPerUnit,
    },
    pxPerUnit: vp.pxPerUnit,
  };
}

/** 줌 배율 한계 — 부동소수 폭주 방지 */
export const MIN_PX_PER_UNIT = 1e-9;
export const MAX_PX_PER_UNIT = 1e9;

/**
 * 커서 앵커 줌 — anchor_px 아래의 world 좌표가 줌 후에도 같은 화면 위치에 남는다.
 * factor > 1 확대, < 1 축소.
 */
export function zoomAtScreenPoint(
  vp: Viewport,
  anchor_px: Vec2,
  factor: number,
  size: CanvasSize,
): Viewport {
  const next = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, vp.pxPerUnit * factor));
  if (next === vp.pxPerUnit) return vp;
  const anchorWorld = screenToWorld(anchor_px, vp, size);
  // anchorWorld가 anchor_px에 그대로 오도록 center 역산
  return {
    center: {
      x: anchorWorld.x - (anchor_px.x - size.width / 2) / next,
      y: anchorWorld.y + (anchor_px.y - size.height / 2) / next,
    },
    pxPerUnit: next,
  };
}

/** Zoom Extents — bounds 전체가 여백(padding_px)을 두고 화면에 들어오는 뷰포트 */
export function fitBoundsViewport(bounds: Bounds, size: CanvasSize, padding_px = 40): Viewport {
  const w = Math.max(bounds.maxX - bounds.minX, Number.EPSILON);
  const h = Math.max(bounds.maxY - bounds.minY, Number.EPSILON);
  const availW = Math.max(size.width - padding_px * 2, 1);
  const availH = Math.max(size.height - padding_px * 2, 1);
  const pxPerUnit = Math.min(
    MAX_PX_PER_UNIT,
    Math.max(MIN_PX_PER_UNIT, Math.min(availW / w, availH / h)),
  );
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    pxPerUnit,
  };
}

/** 현재 뷰포트가 커버하는 world 영역 (컬링 쿼리용) */
export function viewportWorldBounds(vp: Viewport, size: CanvasSize, margin_px = 0): Bounds {
  const halfW = (size.width / 2 + margin_px) / vp.pxPerUnit;
  const halfH = (size.height / 2 + margin_px) / vp.pxPerUnit;
  return {
    minX: vp.center.x - halfW,
    minY: vp.center.y - halfH,
    maxX: vp.center.x + halfW,
    maxY: vp.center.y + halfH,
  };
}
