/**
 * 도면 전환·닫기 오케스트레이터 (다중 도면 워크스페이스).
 *
 * store 순수성 유지: 스냅샷 저장·flat 복원 같은 순수 상태 전이는 store가 하되,
 * canvas 모듈 부수효과(setSceneModel = R-tree 인덱스 재구축)는 여기서만 호출한다.
 * (store 슬라이스는 canvas를 import하지 않는다 — 현 구조 유지)
 *
 * 전환은 "화면맞춤"이 아니라 "저장된 viewport 복원"이다. fitToken을 건드리지 않으므로
 * CanvasStage는 zoomToExtents를 하지 않는다 — 작업 중이던 확대·위치가 그대로 보존된다.
 */
import type { DrawingModel } from '@s-cube/schema';
import { setSceneModel } from '../canvas/scene.ts';
import { useAppStore } from '../store/index.ts';
import type { DrawingTab } from '../store/types.ts';
import { closeDrawingAt, snapshotActive } from '../store/workspace-slice.ts';

/** 현재 flat 라이브 상태를 활성 탭 스냅샷에 저장한 drawings 배열을 반환 (순수 헬퍼 위임) */
function snapshotCurrent(): DrawingTab[] {
  const s = useAppStore.getState();
  if (s.model === null) return s.drawings;
  return snapshotActive(s.drawings, s.activeId, {
    model: s.model,
    viewport: s.viewport,
    calibration: s.calibration,
    layerVisibility: s.layerVisibility,
  });
}

/** 대상 탭 값을 flat 필드로 복원하는 부분 상태 (순수 데이터) */
function flatFromTab(tab: DrawingTab): {
  activeId: string;
  model: DrawingTab['model'];
  fileName: string;
  storageKey: string;
  layerVisibility: Record<string, boolean>;
  viewport: DrawingTab['viewport'];
  calibration: DrawingTab['calibration'];
  calibPoints: [];
  pendingCalibration: null;
  dimCheck: null;
  activeTool: 'pan';
  selectedMeasurementIds: [];
} {
  return {
    activeId: tab.id,
    model: tab.model,
    fileName: tab.fileName,
    storageKey: tab.storageKey,
    layerVisibility: tab.layerVisibility,
    viewport: tab.viewport,
    calibration: tab.calibration,
    // 진행 중이던 도구 상태는 전환 시 초기화 (활성 도면 기준으로 새로 시작)
    calibPoints: [],
    pendingCalibration: null,
    dimCheck: null,
    activeTool: 'pan',
    // 측정 자체는 measurements[]에 drawingId 태깅으로 보존되어 전환 후 돌아오면 그대로 보인다.
    // 다만 선택 하이라이트는 도면 경계에서 초기화한다(다른 도면 handle을 가리키지 않도록).
    selectedMeasurementIds: [],
  };
}

/**
 * 도면 전환 — 현재 활성 탭 스냅샷 저장 → 대상 탭을 flat으로 복원 → 씬 교체.
 * 이미 활성인 도면을 다시 요청하면 조용히 무시한다.
 */
export function switchToDrawing(id: string): void {
  const store = useAppStore.getState();
  if (store.activeId === id) return;

  const snapped = snapshotCurrent();
  const target = snapped.find((d) => d.id === id);
  if (target === undefined) return;

  // (1) 씬(R-tree)을 먼저 새 도면으로 교체한다 — 스냅/히트테스트(findSnap·pickDimensionAt)는
  // scene.index를 직접 쓰므로, setState와 setSceneModel 사이 RAF/입력 프레임이 끼어도
  // '이전 도면 R-tree로 오검색'하는 창을 없앤다(집중 항목 2·4). flatFromTab이 activeTool을
  // 'pan'으로 초기화하므로 스냅은 어차피 비활성이지만, scene-활성model 정합을 코드로 보장한다.
  setSceneModel(target.model);
  // (2) 스냅샷 반영 + (3) flat 필드를 대상 값으로 교체 — 한 번의 set으로 원자 전이
  useAppStore.setState({ drawings: snapped, ...flatFromTab(target) });
}

/**
 * 로드 완료 후처리 오케스트레이터 — scene(R-tree)와 store 활성 model을 한 곳에서 갱신한다.
 *
 * '활성 model을 바꾸는 모든 전이는 반드시 setSceneModel을 동반한다'는 불변식을 단일
 * 진입점으로 수렴시킨다(집중 항목 6). finishLoading이 스냅샷 병합·재열기 판별·flat 복원을
 * 순수하게 처리한 뒤, 그 결과로 확정된 활성 model로 씬을 교체한다 — 순서를 finishLoading
 * 이후로 두어 scene가 항상 '최종 활성 model'을 가리키게 한다.
 */
export function applyLoadedModel(model: DrawingModel, fileName: string): void {
  useAppStore.getState().finishLoading(model, fileName);
  // finishLoading이 확정한 활성 model로 씬 교체 (재열기든 신규든 결과 model 기준).
  setSceneModel(useAppStore.getState().model);
}

/**
 * 도면 닫기 — 탭 제거 후:
 * - 비활성 도면: 활성 유지, 씬 그대로.
 * - 활성 도면: 인접(오른쪽 우선, 없으면 왼쪽)으로 전환. 마지막이면 빈 상태(EmptyHero).
 *
 * 활성 도면을 닫을 땐 스냅샷을 저장하지 않는다(어차피 버리는 탭).
 */
export function closeDrawing(id: string): void {
  const store = useAppStore.getState();
  const wasActive = store.activeId === id;

  // 닫는 대상이 활성이 아니면, 현재 활성 작업상태를 먼저 스냅샷에 보존한다.
  const baseDrawings = wasActive ? store.drawings : snapshotCurrent();

  const { drawings, nextActiveId } = closeDrawingAt(baseDrawings, store.activeId, id);

  // 닫힌 도면의 측정은 함께 제거한다(다른 도면 측정은 보존).
  store.clearMeasurementsForDrawing(id);

  if (nextActiveId === null) {
    // 마지막 탭 닫힘 → 빈 상태 복귀
    useAppStore.setState({
      drawings,
      activeId: null,
      model: null,
      fileName: null,
      storageKey: null,
      layerVisibility: {},
      calibration: null,
      calibPoints: [],
      pendingCalibration: null,
      dimCheck: null,
      activeTool: 'pan',
      selectedMeasurementIds: [],
    });
    setSceneModel(null);
    return;
  }

  if (!wasActive) {
    // 활성은 그대로, 목록만 갱신 (씬 유지)
    useAppStore.setState({ drawings });
    return;
  }

  // 활성 도면을 닫음 → 인접 탭을 flat으로 복원 + 씬 교체
  const target = drawings.find((d) => d.id === nextActiveId);
  if (target === undefined) {
    useAppStore.setState({ drawings });
    return;
  }
  // switchToDrawing과 동일 규칙: 씬을 먼저 새 도면으로 바꿔 스냅/히트테스트 오검색 창을 없앤다.
  setSceneModel(target.model);
  useAppStore.setState({ drawings, ...flatFromTab(target) });
}
