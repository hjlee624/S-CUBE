/**
 * 산출 항목 슬라이스 (Phase 4-B) — 프로젝트 산출 항목(TakeoffItem[]) 상태·CRUD·재계산.
 *
 * 항목은 프로젝트 산출 단위다(ScubeProject.items 와 일치) — 도면 전환과 독립 보존.
 * 각 항목은 schema TakeoffItem(basis·quantity·sourceRefs) 에 편집용 메타(source·specCode
 * 선택 등)를 얹은 EditableTakeoffItem 으로 보관한다. basis 조립·수량 평가는 전부
 * lib/takeoff-build.ts(→ @s-cube/core 빌더) 순수 함수로 하고, 이 슬라이스는 canvas 를
 * import 하지 않는다.
 *
 * 재계산(P4-10): 원본(측정·구간)이 바뀌면 recomputeAll 로 전 항목의 basis 를 소스에서
 * 다시 조립하고 quantity 를 갱신한다. blocked(전 결측) 소스는 basis=null → 항목을
 * '산출 차단' 으로 표시(quantity 는 이전 값 유지하지 않고 NaN 으로 두어 셀에 차단 표기).
 */
import type { StateCreator } from 'zustand';
import { type EditableTakeoffItem, reassembleItem, recomputeItems } from '../lib/takeoff-derive.ts';
import type { AppState, TakeoffSlice } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 순수 상태 전이 (테스트 대상)
// ─────────────────────────────────────────────────────────────────────────────

/** 항목 추가 — 배열 끝에 append (순수) */
export function addItem(
  list: EditableTakeoffItem[],
  item: EditableTakeoffItem,
): EditableTakeoffItem[] {
  return [...list, item];
}

/** 항목 제거 — 해당 id 제거 + 그 항목을 참조하던 항목의 참조에서도 제거 (순수) */
export function removeItem(list: EditableTakeoffItem[], id: string): EditableTakeoffItem[] {
  const pruned = list.filter((it) => it.id !== id);
  // 삭제된 항목을 참조하던 ref 소스에서 해당 참조를 정리한다(끊긴 참조 방지).
  return pruned.map((it) => {
    if (it.source.kind !== 'ref') return it;
    if (!it.source.refItemIds.includes(id)) return it;
    return {
      ...it,
      source: {
        ...it.source,
        refItemIds: it.source.refItemIds.filter((r) => r !== id),
        refs: it.source.refs.filter((r) => r.itemId !== id),
      },
    };
  });
}

/** 항목 순서 이동 (from → to 인덱스) — 공종 트리 정렬 보조 (순수) */
export function moveItem(
  list: EditableTakeoffItem[],
  from: number,
  to: number,
): EditableTakeoffItem[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(to, 0, moved);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이스
// ─────────────────────────────────────────────────────────────────────────────

export const createTakeoffSlice: StateCreator<AppState, [], [], TakeoffSlice> = (set, get) => ({
  items: [],

  addTakeoffItem: (draft) =>
    set((s) => {
      // 조립 시점에 basis·quantity 를 확정한다(소스·규격·현재 단면·측정 원장 기준).
      const spec =
        draft.specCode !== '' ? s.specs.find((sp) => sp.code === draft.specCode) : undefined;
      const assembled = reassembleItem(draft, spec, s.sections, s.items, s.measurements);
      return { items: addItem(s.items, assembled) };
    }),

  updateTakeoffItem: (id, patch) =>
    set((s) => {
      const items = s.items.map((it) => {
        if (it.id !== id) return it;
        const merged: EditableTakeoffItem = { ...it, ...patch };
        const spec =
          merged.specCode !== '' ? s.specs.find((sp) => sp.code === merged.specCode) : undefined;
        return reassembleItem(merged, spec, s.sections, s.items, s.measurements);
      });
      return { items };
    }),

  removeTakeoffItem: (id) => set((s) => ({ items: removeItem(s.items, id) })),

  moveTakeoffItem: (from, to) => set((s) => ({ items: moveItem(s.items, from, to) })),

  /** 재계산 (P4-10) — 원본(측정·구간·규격) 변경 시 전 항목 basis·quantity 갱신 */
  recomputeTakeoff: () =>
    set((s) => ({ items: recomputeItems(s.items, s.specs, s.sections, s.measurements) })),

  replaceTakeoffItems: (items) => set({ items }),

  getTakeoffItem: (id) => get().items.find((it) => it.id === id),
});
