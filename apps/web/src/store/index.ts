/**
 * 앱 스토어 — 슬라이스 조합 (drawing / viewport / calibration / ui).
 *
 * ADR 0002: 캔버스 RAF 루프는 useAppStore.getState()로 직접 읽어
 * React 리렌더를 우회한다. React 컴포넌트는 selector 구독.
 */
import { create } from 'zustand';
import { createCalibrationSlice } from './calibration-slice.ts';
import { createDrawingSlice } from './drawing-slice.ts';
import { createMeasurementSlice } from './measurement-slice.ts';
import type { AppState } from './types.ts';
import { createUiSlice } from './ui-slice.ts';
import { createViewportSlice } from './viewport-slice.ts';
import { createWorkspaceSlice } from './workspace-slice.ts';

export const useAppStore = create<AppState>()((...args) => ({
  ...createDrawingSlice(...args),
  ...createViewportSlice(...args),
  ...createCalibrationSlice(...args),
  ...createUiSlice(...args),
  ...createWorkspaceSlice(...args),
  ...createMeasurementSlice(...args),
}));

export type { AppState, DrawingTab, ToolId } from './types.ts';
