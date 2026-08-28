/**
 * 캔버스 전용 임시 상태 — 마우스 이동마다 바뀌는 값을 Zustand에 넣으면
 * 구독자 알림이 과도해지므로, 렌더 루프만 읽는 모듈 상태로 분리.
 */
import type { Vec2 } from '@s-cube/schema';
import type { SnapResult } from './snap.ts';

export interface OverlayState {
  /** 현재 스냅 후보 (마커 표시) */
  snap: SnapResult | null;
  /** 커서 world 좌표 — 러버밴드 라인 끝점 */
  cursorWorld: Vec2 | null;
  /** 캔버스 CSS 크기 (렌더러가 갱신) */
  canvasWidth: number;
  canvasHeight: number;
}

export const overlay: OverlayState = {
  snap: null,
  cursorWorld: null,
  canvasWidth: 0,
  canvasHeight: 0,
};
