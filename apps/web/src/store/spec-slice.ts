/**
 * 규격 마스터 슬라이스 (Phase 4-A) — 공종·규격 마스터(MaterialSpec[]) 상태·CRUD.
 *
 * 규격은 프로젝트 산출 단위다(ScubeProject.specs 와 일치) — 도면 전환과 독립적으로 보존된다.
 * 초기값은 @s-cube/core 의 MATERIAL_PRESETS(사내 표준 프리셋). 브라우저 영속은
 * localStorage(키 s-cube:specs) — 03-DATA-MODEL 의 ~/.s-cube/specs.json 을 브라우저에서
 * 대체한다. 순수 상태 전이(추가·수정·삭제·프리셋 로드·가져오기 병합)는 아래 순수 함수로
 * 분리해 테스트한다. 이 슬라이스는 canvas 를 import 하지 않는다.
 *
 * 단위 환산·할증률은 규격에 기록만 하고(근거 유지), 실제 적용(convertUnit·applyLoss)은
 * 산출 항목(takeoff)이 basis FormulaNode 조립 시점에 수행한다(계산은 core 에만).
 */
import { MATERIAL_PRESETS } from '@s-cube/core';
import type { MaterialSpec } from '@s-cube/schema';
import type { StateCreator } from 'zustand';
import { loadSpecs, saveSpecs } from '../lib/spec-storage.ts';
import type { AppState, SpecSlice } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 순수 상태 전이 (테스트 대상)
// ─────────────────────────────────────────────────────────────────────────────

/** 규격 추가 — 같은 code 가 이미 있으면 교체(중복 code 금지), 없으면 append (순수) */
export function upsertSpec(list: MaterialSpec[], spec: MaterialSpec): MaterialSpec[] {
  const idx = list.findIndex((s) => s.code === spec.code);
  if (idx === -1) return [...list, spec];
  const next = list.slice();
  next[idx] = spec;
  return next;
}

/** 규격 수정 — 해당 code 만 부분 갱신 (순수). code 자체 변경도 허용(중복이면 무시) */
export function updateSpec(
  list: MaterialSpec[],
  code: string,
  patch: Partial<MaterialSpec>,
): MaterialSpec[] {
  // code 를 바꾸는 경우, 대상 code 가 이미 다른 항목에 있으면 충돌 → 변경 무시.
  if (patch.code !== undefined && patch.code !== code && list.some((s) => s.code === patch.code)) {
    const { code: _drop, ...rest } = patch;
    return list.map((s) => (s.code === code ? { ...s, ...rest } : s));
  }
  return list.map((s) => (s.code === code ? { ...s, ...patch } : s));
}

/** 규격 삭제 — 해당 code 만 제거 (순수) */
export function removeSpec(list: MaterialSpec[], code: string): MaterialSpec[] {
  return list.filter((s) => s.code !== code);
}

/**
 * 가져온 규격들을 현재 목록에 병합 (순수) — code 기준 upsert.
 * 같은 code 는 가져온 값으로 덮어쓰고(최신 우선), 새 code 는 추가한다.
 */
export function mergeSpecs(list: MaterialSpec[], incoming: MaterialSpec[]): MaterialSpec[] {
  let next = list;
  for (const spec of incoming) {
    next = upsertSpec(next, spec);
  }
  return next;
}

/** 프리셋 전체를 현재 목록에 병합 (순수) — 프리셋 code 는 프리셋 값으로 갱신 */
export function loadPresets(list: MaterialSpec[]): MaterialSpec[] {
  return mergeSpecs(list, [...MATERIAL_PRESETS]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이스
// ─────────────────────────────────────────────────────────────────────────────

/** 초기 규격 — localStorage 초안이 있으면 복원, 없으면 프리셋 전체 */
function initialSpecs(): MaterialSpec[] {
  const restored = loadSpecs();
  return restored ?? [...MATERIAL_PRESETS];
}

export const createSpecSlice: StateCreator<AppState, [], [], SpecSlice> = (set, get) => {
  /** 상태 갱신 후 localStorage 에 영속 — 모든 변이의 후처리 */
  const persist = (specs: MaterialSpec[]): { specs: MaterialSpec[] } => {
    saveSpecs(specs);
    return { specs };
  };

  return {
    specs: initialSpecs(),

    upsertSpec: (spec) => set((s) => persist(upsertSpec(s.specs, spec))),

    updateSpec: (code, patch) => set((s) => persist(updateSpec(s.specs, code, patch))),

    removeSpec: (code) => set((s) => persist(removeSpec(s.specs, code))),

    loadSpecPresets: () => set((s) => persist(loadPresets(s.specs))),

    importSpecs: (incoming) => set((s) => persist(mergeSpecs(s.specs, incoming))),

    replaceSpecs: (specs) => set(() => persist(specs)),

    /** 현재 규격을 상태·localStorage 에서 모두 비운다 (초기화) */
    resetSpecs: () => set(() => persist([...MATERIAL_PRESETS])),

    /** 항목 편집기에서 쓰는 조회 — code → MaterialSpec (없으면 undefined) */
    getSpec: (code) => get().specs.find((s) => s.code === code),
  };
};
