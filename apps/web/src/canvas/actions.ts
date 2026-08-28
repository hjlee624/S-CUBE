/**
 * 캔버스 명령 — Zoom Extents (P1-9), 치수 픽킹 (P1-12).
 * UI 컴포넌트·단축키 핸들러가 호출한다.
 */
import type { Vec2 } from '@s-cube/schema';
import { checkDimension } from '../lib/calibration.ts';
import { entityBounds } from '../lib/core-api.ts';
import { useAppStore } from '../store/index.ts';
import { overlay } from './overlay-state.ts';
import { scene } from './scene.ts';
import type { CanvasSize } from './transform.ts';
import { fitBoundsViewport } from './transform.ts';

/** 전체 도면 화면맞춤. size 미지정 시 렌더러가 보고한 캔버스 크기 사용 */
export function zoomToExtents(size?: CanvasSize): void {
  const s = useAppStore.getState();
  const bounds = s.model?.bounds ?? null;
  if (bounds === null) return;
  const target = size ?? { width: overlay.canvasWidth, height: overlay.canvasHeight };
  if (target.width <= 0 || target.height <= 0) return;
  s.setViewport(fitBoundsViewport(bounds, target));
}

/**
 * 치수 대조 픽킹 — 커서 주변에서 가장 가까운 DIMENSION을 찾아 대조 실행.
 * @param pickRadius_px 화면 px 허용 반경
 */
export function pickDimensionAt(worldPos: Vec2, pickRadius_px = 12): void {
  const s = useAppStore.getState();
  const model = s.model;
  const cal = s.calibration;
  if (model === null || cal === null || scene.index === null) return;
  const r_world = pickRadius_px / s.viewport.pxPerUnit;
  const hits = scene.index.search({
    minX: worldPos.x - r_world,
    minY: worldPos.y - r_world,
    maxX: worldPos.x + r_world,
    maxY: worldPos.y + r_world,
  });
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined || e.kind !== 'dimension') continue;
    const b = entityBounds(e);
    if (b === null) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const d = Math.hypot(cx - worldPos.x, cy - worldPos.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = hit.i;
    }
  }
  if (bestIdx < 0) {
    s.showToast('근처에 치수(DIMENSION)가 없습니다', 'info');
    return;
  }
  const dim = model.entities[bestIdx];
  if (dim === undefined || dim.kind !== 'dimension') return;
  s.setDimCheck(checkDimension(dim, cal.scale));
}
