/**
 * 스토어 슬라이스 타입 정의 — 슬라이스 간 순환 import 방지를 위해 분리.
 */
import type { Calibration, DrawingModel, DrawingRole, Vec2 } from '@s-cube/schema';
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
  /** DWG 변환 백엔드 표시명('LibreDWG' 등) — convert 단계 라벨에 병기, 그 외 null */
  convertBackend: string | null;
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
  /**
   * 신규 도면 로드에만 증가하는 카운터 — CanvasStage가 이 값 변화 시에만
   * zoomToExtents(초기 화면맞춤)를 수행한다. 탭 전환은 저장된 viewport를 복원하므로
   * 이 값을 건드리지 않는다 (화면맞춤 금지).
   */
  fitToken: number;
  /** convertBackend: DWG 변환 시 백엔드 표시명('LibreDWG' 등) — 라벨 병기용 */
  startLoading: (fileName: string, convertBackend?: string) => void;
  setLoadProgress: (stage: ParseStage, progress: number) => void;
  /** 모델 확정 + 저장된 캘리브레이션 자동 복원 (P1-13) + 워크스페이스 탭 등록/재열기 */
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

/** ODA File Converter 미설치 안내 모달 상태 (FR-1.2 DWG 자동 변환) */
export interface DwgGuideState {
  /** '설치 후 재시도'용 원본 DWG 파일 */
  file: File;
  /** 서버가 내려준 한국어 설치 안내 (다운로드 URL 포함) */
  guide: string;
}

/**
 * 워크스페이스 도면 탭 — 한 장의 도면과 그 라이브 작업상태 스냅샷.
 *
 * 미러 방식: flat 필드(model/viewport/calibration/layerVisibility)가 "활성 도면의
 * 라이브 상태"이고, 비활성 도면들은 여기 스냅샷으로 보존된다. 전환 시 현재 flat을
 * 활성 탭에 저장 → 대상 탭 스냅샷을 flat으로 복원한다.
 */
export interface DrawingTab {
  /** crypto.randomUUID() */
  id: string;
  fileName: string;
  role: DrawingRole;
  entityCount: number;
  /** 캘리브레이션 저장 키 — 재열기 판별(제자리 교체)에 사용 */
  storageKey: string;
  model: DrawingModel;
  /** 스냅샷된 뷰포트 (전환 복원용 — 화면맞춤 아님) */
  viewport: Viewport;
  calibration: Calibration | null;
  layerVisibility: Record<string, boolean>;
}

export interface WorkspaceSlice {
  /** 열린 도면 탭 목록 (열린 순서) */
  drawings: DrawingTab[];
  /** 활성(중앙 표시) 도면 탭 id. 도면 0개면 null */
  activeId: string | null;
  /** 도면 역할 변경 (탭 배지 드롭다운) */
  setDrawingRole: (id: string, role: DrawingRole) => void;
}

export interface UiSlice {
  activeTool: ToolId;
  toast: ToastState | null;
  /** null이면 모달 닫힘 */
  dwgGuide: DwgGuideState | null;
  setActiveTool: (tool: ToolId) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  dismissToast: (id: number) => void;
  showDwgGuide: (file: File, guide: string) => void;
  dismissDwgGuide: () => void;
}

export type AppState = DrawingSlice & ViewportSlice & CalibrationSlice & UiSlice & WorkspaceSlice;
