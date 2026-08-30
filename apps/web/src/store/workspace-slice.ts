/**
 * 워크스페이스 슬라이스 — 다중 도면 탭 목록·활성 도면 관리 (미러 방식).
 *
 * flat 필드(model/viewport/calibration/layerVisibility)는 "활성 도면의 라이브
 * 작업상태"로 유지되고, 비활성 도면은 여기 drawings[] 스냅샷으로 보존된다.
 * 전환·닫기의 canvas 부수효과(setSceneModel)는 store 순수성 유지를 위해
 * lib/switch-drawing.ts 오케스트레이터가 담당한다 (이 슬라이스는 canvas import 금지).
 *
 * 순수 로직(스냅샷 저장·복원·재열기 제자리교체·인접 전환 대상 선택)은 아래
 * 순수 함수로 분리해 테스트한다 (workspace-slice.test.ts).
 */
import type { Calibration, DrawingModel, DrawingRole } from '@s-cube/schema';
import type { StateCreator } from 'zustand';
import type { Viewport } from '../canvas/transform.ts';
import type { AppState, DrawingTab, WorkspaceSlice } from './types.ts';

/** 활성 도면의 flat 라이브 상태 — 스냅샷 저장·복원의 최소 단위 */
export interface LiveDrawingState {
  model: DrawingModel;
  viewport: Viewport;
  calibration: Calibration | null;
  layerVisibility: Record<string, boolean>;
}

/**
 * 현재 flat 라이브 상태를 활성 탭 스냅샷에 병합한다 — 순수.
 * activeId에 해당하는 탭만 갱신하고 나머지는 그대로 둔다.
 * 활성 탭이 없거나(로드 전) 목록에 없으면 원본을 그대로 반환한다.
 */
export function snapshotActive(
  drawings: DrawingTab[],
  activeId: string | null,
  live: LiveDrawingState,
): DrawingTab[] {
  if (activeId === null) return drawings;
  return drawings.map((d) =>
    d.id === activeId
      ? {
          ...d,
          model: live.model,
          viewport: live.viewport,
          calibration: live.calibration,
          layerVisibility: live.layerVisibility,
        }
      : d,
  );
}

/**
 * 재열기(제자리 교체) 결과 — 갱신된 배열 + 재열기 여부 + (재열기면) 보존 대상 탭.
 *
 * reopened가 true면 신규 로드가 아니라 같은 도면을 다시 연 것이다. 이때 호출부는
 * fitToken을 증가시키지 않고 기존 viewport/calibration/layerVisibility를 유지해야 한다
 * (사용자가 잡아둔 확대·위치·캘리브레이션을 화면맞춤으로 날려버리지 않는다).
 * prev는 교체 직전의 기존 탭 스냅샷 — 라이브 상태 병합의 기준값이다.
 */
export interface UpsertResult {
  drawings: DrawingTab[];
  reopened: boolean;
  prev: DrawingTab | null;
}

/**
 * storageKey가 같은 탭이 있으면 제자리 교체(재열기), 없으면 배열 끝에 추가 — 순수.
 *
 * 재열기(idx!==-1)일 때는 model/entityCount/role/fileName만 새 값으로 갱신하고,
 * viewport/calibration/layerVisibility는 기존 탭 값을 보존한다 — 재드롭으로 사용자가
 * 잡아둔 뷰·캘리브레이션이 유실되지 않도록(집중 항목 3·6). 새 tab의 id는 유지하되
 * 반환된 배열에서 tab.id가 활성 대상이 되도록 호출부가 activeId=tab.id로 세팅한다.
 */
export function upsertDrawing(drawings: DrawingTab[], tab: DrawingTab): UpsertResult {
  const idx = drawings.findIndex((d) => d.storageKey === tab.storageKey);
  if (idx === -1) return { drawings: [...drawings, tab], reopened: false, prev: null };
  const prev = drawings[idx] ?? null;
  const next = drawings.slice();
  // 재열기 병합: 새 도면의 정체성(model/entityCount/role/fileName/id)은 교체하되,
  // 라이브 상태(viewport/calibration/layerVisibility)는 기존 탭 값을 우선 보존한다.
  next[idx] =
    prev === null
      ? tab
      : {
          ...tab,
          viewport: prev.viewport,
          calibration: prev.calibration,
          layerVisibility: prev.layerVisibility,
        };
  return { drawings: next, reopened: true, prev };
}

/**
 * 탭 하나를 제거한 목록과 다음 활성 대상 id를 계산한다 — 순수.
 *
 * 닫는 탭이 활성이 아니면 activeId 유지. 활성이면 인접(오른쪽 우선, 없으면 왼쪽)으로
 * 이동하고, 마지막 탭이었으면 nextActiveId = null (빈 상태).
 */
export interface CloseResult {
  drawings: DrawingTab[];
  nextActiveId: string | null;
}

export function closeDrawingAt(
  drawings: DrawingTab[],
  activeId: string | null,
  closeId: string,
): CloseResult {
  const idx = drawings.findIndex((d) => d.id === closeId);
  if (idx === -1) return { drawings, nextActiveId: activeId };

  const next = drawings.filter((d) => d.id !== closeId);

  // 활성 도면이 아니면 활성 유지
  if (activeId !== closeId) return { drawings: next, nextActiveId: activeId };

  if (next.length === 0) return { drawings: next, nextActiveId: null };

  // 필터 후 배열 기준으로 인접 선택: 원래 오른쪽 이웃(제거로 idx가 오른쪽을 가리킴)을
  // 우선하되, 마지막 탭이었으면 idx가 길이를 벗어나므로 length-1로 clamp해 왼쪽으로 넘어간다.
  const neighbor = next[Math.min(idx, next.length - 1)];
  return { drawings: next, nextActiveId: neighbor?.id ?? null };
}

/** 도면 역할 변경 — 순수 */
export function setRole(drawings: DrawingTab[], id: string, role: DrawingRole): DrawingTab[] {
  return drawings.map((d) => (d.id === id ? { ...d, role } : d));
}

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set) => ({
  drawings: [],
  activeId: null,

  setDrawingRole: (id, role) => set((s) => ({ drawings: setRole(s.drawings, id, role) })),
});
