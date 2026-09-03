/**
 * 프로젝트 메타 슬라이스 (Phase 4-D) — .scube 봉투 정보 + 산출 도크 UI 상태.
 *
 * 이름·작성자·생성시각만 소유한다(측점 간격은 station-slice, 규격·항목은 각 슬라이스).
 * 프로젝트 복원(project-io) 시 setProjectName/setAuthor + createdAt 반영은 오케스트레이터가
 * set 으로 직접 수행한다. 이 슬라이스는 canvas 를 import 하지 않는다.
 */
import type { StateCreator } from 'zustand';
import type { AppState, ProjectSlice } from './types.ts';

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set) => ({
  projectName: '',
  author: '',
  createdAt: new Date().toISOString(),

  setProjectName: (name) => set({ projectName: name }),
  setAuthor: (author) => set({ author }),

  history: [],
  addHistoryEntry: (entry) =>
    set((s) => ({
      history: [...s.history, { ...entry, id: crypto.randomUUID(), at: new Date().toISOString() }],
    })),
  replaceHistory: (entries) => set({ history: entries }),

  takeoffDockOpen: false,
  takeoffDockTab: 'items',

  toggleTakeoffDock: () => set((s) => ({ takeoffDockOpen: !s.takeoffDockOpen })),
  setTakeoffDockTab: (tab) => set({ takeoffDockTab: tab, takeoffDockOpen: true }),
});
