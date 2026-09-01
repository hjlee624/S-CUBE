/**
 * 스토어 슬라이스 타입 정의 — 슬라이스 간 순환 import 방지를 위해 분리.
 */
import type {
  Calibration,
  DrawingModel,
  DrawingRole,
  MaterialSpec,
  Measurement,
  StationSection,
  Vec2,
} from '@s-cube/schema';
import type { Viewport } from '../canvas/transform.ts';
import type { DimensionCheck } from '../lib/calibration.ts';
import type { TakeoffSource } from '../lib/takeoff-build.ts';
import type { EditableTakeoffItem, TakeoffDraft } from '../lib/takeoff-derive.ts';
import type { ParseStage } from '../workers/messages.ts';

/** 활성 도구 (P1-10, P1-12, P2-6) */
export type ToolId = 'pan' | 'calibrate' | 'dim-check' | 'measure';

/** 하단 측점·체적 도크 탭 (Phase 3-C) */
export type StationDockTab = 'table' | 'segments' | 'profile';

/**
 * 수량산출 작업대 통합 탭 (별도 창 분리) — 측점/체적/프로파일 + 규격·항목 + 내보내기 를
 * 하나의 컨테이너에 모은다. 도킹 모드·분리 모드에서 동일하게 쓰인다.
 */
export type WorkbenchTab = 'stations' | 'segments' | 'profile' | 'specs' | 'items' | 'export';

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

/**
 * 측정 슬라이스 (P2-10) — 측정 결과 목록 + 선택 상태.
 *
 * measurements[]는 모든 도면의 측정을 drawingId 태깅으로 함께 보관한다(ScubeProject 구조와
 * 일치). 활성 도면 것만 UI에 표시하는 필터는 표시 시점에 적용한다(measurementsForDrawing).
 * selectedIds는 다중선택 합산·하이라이트 대상. 도면 전환 시 selectedIds만 초기화한다
 * (측정 자체는 도면별로 보존되어 전환 후 돌아오면 그대로 보인다).
 *
 * 순수 상태 전이(추가·삭제·라벨수정·선택토글·도면별 제거)는 measurement-slice.ts 순수 함수로
 * 분리해 테스트한다. Measurement 조립(축척 적용·검증)은 lib/measure.ts 가 담당한다.
 */
export interface MeasurementSlice {
  /** 전 도면 측정 목록 (drawingId 태깅) */
  measurements: Measurement[];
  /** 선택된 측정 id 집합 (다중선택 합산·하이라이트) */
  selectedMeasurementIds: string[];
  addMeasurement: (m: Measurement) => void;
  removeMeasurement: (id: string) => void;
  /** 인라인 명명 편집 */
  updateMeasurementLabel: (id: string, label: string) => void;
  /** 도면 닫힘 시 그 도면 측정 일괄 제거 */
  clearMeasurementsForDrawing: (drawingId: string) => void;
  /** 단일 선택(교체). null이면 선택 해제 */
  selectMeasurement: (id: string | null) => void;
  /** Shift 추가/해제 토글 */
  toggleMeasurementSelection: (id: string) => void;
  /** 선택 초기화 (도면 전환 시) */
  clearMeasurementSelection: () => void;
}

/**
 * 측점 슬라이스 (Phase 3-C) — 프로젝트 단위 측점·단면 상태.
 *
 * 측점은 도면별이 아니라 프로젝트 산출 단위이므로 도면 전환과 독립적으로 보존된다
 * (drawingId 태깅 없음). 파생(정렬·구간·이상)은 표시 시점에 lib/station-derive.ts
 * 순수 함수로 계산한다. 순수 상태 전이는 station-slice.ts 순수 함수로 분리해 테스트한다.
 */
export interface StationSlice {
  /** 측점 간격 (m) — 프로젝트 설정, 통상 20 */
  stationInterval_m: number;
  /** 전 항목(itemKey)의 측점 단면 목록 */
  sections: StationSection[];
  /** 사용자 정의 항목 키('절토'·'성토'·'표토제거' …) */
  itemKeys: string[];
  /** 단면 추가 (파싱된 station 포함) */
  addSection: (section: StationSection) => void;
  /** 단면 제거 */
  removeSection: (id: string) => void;
  /** 단면적 수동 수정 — measurementId 연결 해제 */
  updateSectionArea: (id: string, area_m2: number) => void;
  /** 측정값을 단면에 할당 (P3-12) — area_m2·measurementId 동시 설정 */
  assignMeasurementToSection: (id: string, measurementId: string, area_m2: number) => void;
  /** 측점 원표기(raw) 수정 — 재파싱해 station 갱신 */
  updateSectionRaw: (id: string, raw: string) => void;
  /** 측점 간격 변경 — 기존 단면 chainage 를 raw 로 되파싱 */
  setStationInterval: (interval_m: number) => void;
  /** 항목 추가 (중복 무시) */
  addItemKey: (key: string) => void;
  /** 항목 이름 변경 — 키 목록과 해당 단면들을 함께 갱신 */
  renameItemKey: (from: string, to: string) => void;
}

/**
 * 규격 마스터 슬라이스 (Phase 4-A) — 공종·규격 마스터(MaterialSpec[]).
 *
 * 규격은 프로젝트 산출 단위다(ScubeProject.specs). MATERIAL_PRESETS 로 초기화하고
 * localStorage(s-cube:specs)에 영속한다. CRUD·프리셋 로드·가져오기는 순수 함수로 분리.
 */
export interface SpecSlice {
  specs: MaterialSpec[];
  /** 추가/교체 — 같은 code 면 교체(중복 code 금지) */
  upsertSpec: (spec: MaterialSpec) => void;
  /** 부분 수정 (code 로 지정) */
  updateSpec: (code: string, patch: Partial<MaterialSpec>) => void;
  removeSpec: (code: string) => void;
  /** 사내 표준 프리셋 병합 로드 (P4-2) */
  loadSpecPresets: () => void;
  /** JSON 가져오기 — code 기준 병합 (P4-5) */
  importSpecs: (incoming: MaterialSpec[]) => void;
  /** 전체 교체 (프로젝트 복원) */
  replaceSpecs: (specs: MaterialSpec[]) => void;
  /** 프리셋으로 초기화 */
  resetSpecs: () => void;
  /** code → MaterialSpec 조회 */
  getSpec: (code: string) => MaterialSpec | undefined;
}

/**
 * 산출 항목 슬라이스 (Phase 4-B) — 프로젝트 산출 항목(TakeoffItem[]).
 *
 * 각 항목은 편집 메타(source)를 얹은 EditableTakeoffItem 으로 보관한다. basis 조립·수량
 * 평가는 lib/takeoff-* 순수 함수로 하고, 원본(측정·구간·규격) 변경 시 recomputeTakeoff 로
 * 전 항목을 갱신한다(P4-10).
 */
export interface TakeoffSlice {
  items: EditableTakeoffItem[];
  /** 초안으로 항목 추가 — 조립 시점에 basis·quantity 확정 */
  addTakeoffItem: (draft: TakeoffDraft) => void;
  /** 항목 수정 — 소스·규격 변경 시 basis·quantity 재조립 */
  updateTakeoffItem: (
    id: string,
    patch: Partial<Pick<EditableTakeoffItem, 'workType' | 'name' | 'specCode' | 'unit'>> & {
      source?: TakeoffSource;
      sourceRefs?: EditableTakeoffItem['sourceRefs'];
    },
  ) => void;
  removeTakeoffItem: (id: string) => void;
  moveTakeoffItem: (from: number, to: number) => void;
  /** 재계산 (P4-10) — 원본 변경 반영 */
  recomputeTakeoff: () => void;
  /** 전체 교체 (프로젝트 복원) */
  replaceTakeoffItems: (items: EditableTakeoffItem[]) => void;
  getTakeoffItem: (id: string) => EditableTakeoffItem | undefined;
}

/**
 * 프로젝트 메타 슬라이스 (Phase 4-D) — .scube 봉투 정보 + 산출/저장 UI 상태.
 * 측점 간격은 station-slice 가 소유하므로 여기서는 이름·작성자·생성시각만 둔다.
 */
export interface ProjectSlice {
  /** 프로젝트명 (표지·파일명) */
  projectName: string;
  /** 작성자 */
  author: string;
  /** 생성 시각 (ISO8601) — 최초 저장/조립 시 고정 */
  createdAt: string;
  setProjectName: (name: string) => void;
  setAuthor: (author: string) => void;
  /** 산출 도크 열림 (Phase 4) */
  takeoffDockOpen: boolean;
  /** 산출 도크 활성 탭 */
  takeoffDockTab: TakeoffDockTab;
  toggleTakeoffDock: () => void;
  setTakeoffDockTab: (tab: TakeoffDockTab) => void;
}

/** 산출 도크 탭 (Phase 4) — 규격 마스터 / 산출 항목 */
export type TakeoffDockTab = 'specs' | 'items';

export interface UiSlice {
  activeTool: ToolId;
  toast: ToastState | null;
  /** null이면 모달 닫힘 */
  dwgGuide: DwgGuideState | null;
  /** 하단 측점·체적 도크 열림 여부 (Phase 3-C) */
  stationDockOpen: boolean;
  /** 하단 도크 활성 탭 (Phase 3-C) */
  stationDockTab: StationDockTab;
  /** 수량산출 작업대(통합 도크) 열림 여부 */
  workbenchOpen: boolean;
  /** 수량산출 작업대 활성 탭 (도킹·분리 공용) */
  workbenchTab: WorkbenchTab;
  setActiveTool: (tool: ToolId) => void;
  showToast: (message: string, tone?: ToastState['tone']) => void;
  dismissToast: (id: number) => void;
  showDwgGuide: (file: File, guide: string) => void;
  dismissDwgGuide: () => void;
  /** 도크 열림 토글 */
  toggleStationDock: () => void;
  /** 도크 탭 전환 (열려 있지 않으면 함께 연다) */
  setStationDockTab: (tab: StationDockTab) => void;
  /** 작업대 열림 토글 */
  toggleWorkbench: () => void;
  /** 작업대 탭 전환 (열려 있지 않으면 함께 연다) */
  setWorkbenchTab: (tab: WorkbenchTab) => void;
}

export type AppState = DrawingSlice &
  ViewportSlice &
  CalibrationSlice &
  UiSlice &
  WorkspaceSlice &
  MeasurementSlice &
  StationSlice &
  SpecSlice &
  TakeoffSlice &
  ProjectSlice;
