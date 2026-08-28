/**
 * 스토어 슬라이스 타입 정의 — 슬라이스 간 순환 import 방지를 위해 분리.
 */
import type { Calibration, DrawingModel, Vec2 } from '@s-cube/schema';
import type { Viewport } from '../canvas/transform.ts';
import type { DimensionCheck } from '../lib/calibration.ts';
import type { ParseStage } from '../workers/messages.ts';

/** 활성 도구 (P1-10, P1-12) */
export type ToolId = 'pan' | 'calibrate' | 'dim-check';

export interface LoadingState {
  active: boolean;
  stage: ParseStage | null;
  /** 0~1, indeterminate는 -1 */
  progress: number;
  fileName: string | null;
}

export interface ToastState {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

export interface DrawingSlice {
  model: DrawingModel | null;
  fileName: string | null;
  /** 캘리브레이션 저장 키 (파일명+엔티티수+bounds 해시) */
  storageKey: string | null;
  loading: LoadingState;
  loadError: string | null;
  /** 레이어명 → 표시 여부 (렌더러가 getState()로 소비) */
  layerVisibility: Record<string, boolean>;
  startLoading: (fileName: string) => void;
  setLoadProgress: (stage: ParseStage, progress: number) => void;
  /** 모델 확정 + 저장된 캘리브레이션 자동 복원 (P1-13) */
  finishLoading: (model: DrawingModel, fileName: string) => void;
  failLoading: (message: string) => void;
  toggleLayer: (name: string) => void;
  setAllLayersVisible: (visible: boolean) => void;
}

export interface ViewportSlice {
  viewport: Viewport;
  cursorWorld: Vec2 | null;
  setViewport: (vp: Viewport) => void;
  setCursorWorld: (p: Vec2 | null) => void;
}

export interface PendingCalibration {
  p1: Vec2;
  p2: Vec2;
  drawingDistance: number;
}

export interface CalibrationSlice {
  calibration: Calibration | null;
  /** 도구 진행 중 클릭된 점 (0~1개; 2점째에 pending으로 전환) */
  calibPoints: Vec2[];
  /** 2점 확정 후 실제 거리 입력 대기 (모달 표시 트리거) */
  pendingCalibration: PendingCalibration | null;
  /** 치수 대조 결과 (P1-12) */
  dimCheck: DimensionCheck | null;
  addCalibPoint: (p: Vec2) => void;
  cancelCalibration: () => void;
  /** 모달 확정 — 검증·저장까지 수행 */
  applyCalibration: (cal: Calibration) => void;
  clearCalibration: () => void;
  setDimCheck: (check: DimensionCheck | null) => void;
}

export interface UiSlice {
  activeTool: ToolId;
  toast: ToastState | null;
  setActiveTool: (tool: ToolId) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  dismissToast: (id: number) => void;
}

export type AppState = DrawingSlice & ViewportSlice & CalibrationSlice & UiSlice;
