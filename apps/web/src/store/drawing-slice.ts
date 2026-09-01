/**
 * 도면 슬라이스 — 모델·로딩 상태·레이어 표시 여부.
 * 모델 확정 시 localStorage에서 캘리브레이션 자동 복원 (P1-13) +
 * 워크스페이스 탭 등록(신규) / 제자리 교체(재열기).
 */
import { suggestRoleFromName } from '@s-cube/core';
import type { StateCreator } from 'zustand';
import { calibrationStorageKey, loadCalibration } from '../lib/storage.ts';
import type { AppState, DrawingSlice, DrawingTab } from './types.ts';
import { snapshotActive, upsertDrawing } from './workspace-slice.ts';

/** 신규 도면 초기 뷰포트 — CanvasStage가 fitToken 변화로 곧 zoomToExtents 한다 */
const INITIAL_VIEWPORT = { center: { x: 0, y: 0 }, pxPerUnit: 1 } as const;

export const createDrawingSlice: StateCreator<AppState, [], [], DrawingSlice> = (set) => ({
  model: null,
  fileName: null,
  storageKey: null,
  loading: { active: false, stage: null, progress: 0, fileName: null, convertBackend: null },
  loadError: null,
  layerVisibility: {},
  fitToken: 0,

  startLoading: (fileName, convertBackend) =>
    set({
      loading: {
        active: true,
        stage: 'read',
        progress: 0,
        fileName,
        convertBackend: convertBackend ?? null,
      },
      loadError: null,
    }),

  setLoadProgress: (stage, progress) =>
    set((s) => ({ loading: { ...s.loading, stage, progress } })),

  finishLoading: (model, fileName) => {
    const storageKey = calibrationStorageKey(fileName, model.entities.length, model.bounds);
    const restored = loadCalibration(storageKey);
    const layerVisibility: Record<string, boolean> = {};
    for (const layer of model.layers) layerVisibility[layer.name] = layer.visible;

    set((s) => {
      // (1) 기존 활성 탭이 있으면 라이브 WIP(뷰포트·캘리브레이션·레이어표시)를 먼저
      // 스냅샷에 병합한다 — 로드로 flat 필드를 덮어쓰기 전에 보존(집중 항목 1).
      const baseDrawings =
        s.activeId !== null && s.model !== null
          ? snapshotActive(s.drawings, s.activeId, {
              model: s.model,
              viewport: s.viewport,
              calibration: s.calibration,
              layerVisibility: s.layerVisibility,
            })
          : s.drawings;

      // 워크스페이스 탭 등록 — storageKey 동일 탭이 있으면 제자리 교체(재열기), 없으면 추가.
      // 신규 viewport는 초기값; 실제 화면맞춤은 CanvasStage가 fitToken 변화 후 수행한다.
      const tab: DrawingTab = {
        id: crypto.randomUUID(),
        fileName,
        role: suggestRoleFromName(fileName),
        entityCount: model.entities.length,
        storageKey,
        model,
        viewport: { center: { ...INITIAL_VIEWPORT.center }, pxPerUnit: INITIAL_VIEWPORT.pxPerUnit },
        calibration: restored,
        layerVisibility,
      };

      const { drawings, reopened } = upsertDrawing(baseDrawings, tab);

      // 재열기면 병합된 탭에서 기존 라이브 상태를 flat으로 복원한다(집중 항목 2·3·5).
      // upsertDrawing이 viewport/calibration/layerVisibility를 기존 탭 값으로 보존했으므로
      // 그 탭을 그대로 읽어 flat에 반영하고 fitToken은 건드리지 않는다(저장 뷰 유지).
      const merged = reopened ? drawings.find((d) => d.id === tab.id) : undefined;
      const nextViewport = merged?.viewport ?? tab.viewport;
      const nextCalibration = merged?.calibration ?? restored;
      const nextLayerVisibility = merged?.layerVisibility ?? layerVisibility;

      return {
        drawings,
        activeId: tab.id,
        model,
        fileName,
        storageKey,
        layerVisibility: nextLayerVisibility,
        viewport: nextViewport,
        // 신규 로드에만 증가 → CanvasStage가 이 변화에만 초기 화면맞춤(zoomToExtents).
        // 재열기는 저장 뷰포트를 유지해야 하므로 증가시키지 않는다(집중 항목 5).
        fitToken: reopened ? s.fitToken : s.fitToken + 1,
        loading: { active: false, stage: null, progress: 0, fileName: null, convertBackend: null },
        loadError: null,
        // 새 도면 로드 → 도구·대조 상태 초기화, 캘리브레이션 복원(재열기면 기존 라이브 우선)
        calibration: nextCalibration,
        calibPoints: [],
        pendingCalibration: null,
        dimCheck: null,
        activeTool: 'pan',
        // 측정 선택 하이라이트는 도면 경계에서 초기화 (측정 목록 자체는 drawingId 태깅으로 보존).
        selectedMeasurementIds: [],
      };
    });
  },

  failLoading: (message) =>
    set({
      loading: { active: false, stage: null, progress: 0, fileName: null, convertBackend: null },
      loadError: message,
    }),

  toggleLayer: (name) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [name]: !(s.layerVisibility[name] ?? true) },
    })),

  setAllLayersVisible: (visible) =>
    set((s) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(s.layerVisibility)) next[key] = visible;
      return { layerVisibility: next };
    }),
});
