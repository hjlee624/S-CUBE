/**
 * 워크스페이스 도면 → ProjectDrawing[] 수집 (Phase 4-C·4-D 공용).
 *
 * 저장·내보내기 양쪽이 쓰는 도면 메타 수집을 한 곳에 모은다. 활성 도면의 라이브 상태
 * (flat calibration/layerVisibility)는 아직 탭 스냅샷에 병합되지 않았을 수 있으므로,
 * activeId 탭에는 flat 값을 우선 반영한다(집중: 저장 시점 최신 상태 보존).
 *
 * contentHash 는 storage.ts 의 calibrationStorageKey(파일명+엔티티수+bounds) 재사용 —
 * 도면이 교체·수정되면 달라져 P4-17 무결성 경고 근거가 된다.
 */
import type { DrawingModel, DrawingRole } from '@s-cube/schema';
import type { AppState } from '../store/types.ts';
import { toDrawingRole } from './project-io.ts';
import type { ProjectDrawing } from './project-schema.ts';
import { drawingContentHash } from './storage.ts';

/** DrawingModel 의 레이어를 ProjectDrawing.layers 형태로 (순수) */
function toProjectLayers(model: DrawingModel): ProjectDrawing['layers'] {
  return model.layers.map((l) => ({
    name: l.name,
    colorIndex: l.colorIndex,
    visible: l.visible,
    entityCount: l.entityCount,
  }));
}

/**
 * 워크스페이스 탭들에서 ProjectDrawing[] 을 만든다 (순수, storage 해시만 사용).
 *
 * 활성 탭은 flat calibration 을 우선 반영해 '방금 캘리브레이션한 값'이 저장에서 누락되지
 * 않게 한다(finishLoading 스냅샷 병합 이전 시점 대비).
 */
export function collectProjectDrawings(
  state: Pick<AppState, 'drawings' | 'activeId' | 'calibration'>,
): ProjectDrawing[] {
  return state.drawings.map((tab) => {
    const isActive = tab.id === state.activeId;
    const calibration = isActive ? state.calibration : tab.calibration;
    const contentHash = drawingContentHash(tab.model);
    const role: DrawingRole = toDrawingRole(tab.role);
    return {
      id: tab.id,
      fileName: tab.fileName,
      role,
      entityCount: tab.entityCount,
      contentHash,
      dxfVersion: tab.model.dxfVersion,
      insUnits: tab.model.insUnits,
      calibration,
      layers: toProjectLayers(tab.model),
    };
  });
}

/** 현재 열린 도면들의 (파일명, 지문) — P4-17 무결성 대조 입력 (순수) */
export function currentDrawingHashes(
  state: Pick<AppState, 'drawings'>,
): { fileName: string; contentHash: string }[] {
  return state.drawings.map((tab) => ({
    fileName: tab.fileName,
    contentHash: drawingContentHash(tab.model),
  }));
}
