/**
 * 도면 슬라이스 — 모델·로딩 상태·레이어 표시 여부.
 * 모델 확정 시 localStorage에서 캘리브레이션 자동 복원 (P1-13).
 */
import type { StateCreator } from 'zustand';
import { calibrationStorageKey, loadCalibration } from '../lib/storage.ts';
import type { AppState, DrawingSlice } from './types.ts';

export const createDrawingSlice: StateCreator<AppState, [], [], DrawingSlice> = (set) => ({
  model: null,
  fileName: null,
  storageKey: null,
  loading: { active: false, stage: null, progress: 0, fileName: null },
  loadError: null,
  layerVisibility: {},

  startLoading: (fileName) =>
    set({
      loading: { active: true, stage: 'read', progress: 0, fileName },
      loadError: null,
    }),

  setLoadProgress: (stage, progress) =>
    set((s) => ({ loading: { ...s.loading, stage, progress } })),

  finishLoading: (model, fileName) => {
    const storageKey = calibrationStorageKey(fileName, model.entities.length, model.bounds);
    const restored = loadCalibration(storageKey);
    const layerVisibility: Record<string, boolean> = {};
    for (const layer of model.layers) layerVisibility[layer.name] = layer.visible;
    set({
      model,
      fileName,
      storageKey,
      layerVisibility,
      loading: { active: false, stage: null, progress: 0, fileName: null },
      loadError: null,
      // 새 도면 로드 → 도구·대조 상태 초기화, 저장된 캘리브레이션 복원
      calibration: restored,
      calibPoints: [],
      pendingCalibration: null,
      dimCheck: null,
      activeTool: 'pan',
    });
  },

  failLoading: (message) =>
    set({
      loading: { active: false, stage: null, progress: 0, fileName: null },
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
