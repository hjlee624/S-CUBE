/**
 * 뷰포트 슬라이스 — 캔버스 루프는 getState()로 읽는다 (ADR 0002: React 리렌더 우회).
 */
import type { StateCreator } from 'zustand';
import type { AppState, ViewportSlice } from './types.ts';

export const createViewportSlice: StateCreator<AppState, [], [], ViewportSlice> = (set) => ({
  viewport: { center: { x: 0, y: 0 }, pxPerUnit: 1 },
  cursorWorld: null,
  setViewport: (vp) => set({ viewport: vp }),
  setCursorWorld: (p) => set({ cursorWorld: p }),
});
