/**
 * .scube 저장/불러오기 (Phase 4-D, P4-16·P4-17·P4-18).
 *
 * 순수 조립/역조립(assembleProject·restoreFromProject·serializeProject)과 부수효과
 * (파일 다운로드·파일 열기·상태 반영)를 분리한다 — 순수부는 단위 테스트 대상.
 *
 * 도면 무결성(P4-17): 저장 시 각 도면의 contentHash(storageKey)를 기록하고, 열 때 현재
 * 워크스페이스에 같은 이름의 도면이 있으면 해시를 대조해 바뀌었으면 경고를 만든다
 * (참조 도면이 교체·수정되었을 수 있음).
 */
import {
  type ChangeLogEntry,
  DRAWING_ROLES,
  type DrawingRole,
  type LayerRule,
  SCHEMA_VERSION,
} from '@s-cube/schema';
import type { AppState } from '../store/types.ts';
import type { ProjectDrawing, ProjectMeta, ScubeProject } from './project-schema.ts';
import { parseScubeProject, serializeScubeProject } from './project-schema.ts';
import { toTakeoffItem } from './takeoff-derive.ts';

/** 조립에 필요한 앱 상태 부분집합 — store 전체 대신 좁은 입력으로 테스트 용이 */
export interface ProjectAssemblyInput {
  meta: Pick<ProjectMeta, 'projectName' | 'author'> & { stationInterval_m: number };
  drawings: {
    id: string;
    fileName: string;
    role: string;
    entityCount: number;
    contentHash: string;
    dxfVersion: string;
    insUnits: number;
    calibration: AppState['calibration'];
    layers: { name: string; colorIndex: number; visible: boolean; entityCount: number }[];
  }[];
  measurements: AppState['measurements'];
  sections: AppState['sections'];
  specs: AppState['specs'];
  items: AppState['items'];
  history?: ChangeLogEntry[];
  layerRules?: LayerRule[];
  /** createdAt 을 유지하기 위한 기존 프로젝트 메타 (없으면 now) */
  existingCreatedAt?: string;
}

/**
 * 앱 상태 → ScubeProject (순수, 03-DATA-MODEL §7).
 *
 * 산출 항목은 toTakeoffItem 으로 schema TakeoffItem 로 좁힌다 — basis 가 null(전 결측 차단)인
 * 항목은 저장에서 제외한다(차단 항목을 조용히 0 으로 저장하지 않는다). blockedItemIds 로
 * 제외된 항목을 함께 돌려줘 호출 측이 경고할 수 있게 한다.
 */
export function assembleProject(
  input: ProjectAssemblyInput,
  now: string,
): { project: ScubeProject; blockedItemIds: string[] } {
  const blockedItemIds: string[] = [];
  const items = input.items.flatMap((it) => {
    const narrowed = toTakeoffItem(it);
    if (narrowed === null) {
      blockedItemIds.push(it.id);
      return [];
    }
    return [narrowed];
  });

  const drawings: ProjectDrawing[] = input.drawings.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    role: toDrawingRole(d.role),
    entityCount: d.entityCount,
    contentHash: d.contentHash,
    dxfVersion: d.dxfVersion,
    insUnits: d.insUnits,
    calibration: d.calibration,
    layers: d.layers,
  }));

  const project: ScubeProject = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      projectName: input.meta.projectName,
      author: input.meta.author,
      createdAt: input.existingCreatedAt ?? now,
      updatedAt: now,
      stationInterval_m: input.meta.stationInterval_m,
    },
    drawings,
    measurements: [...input.measurements],
    sections: [...input.sections],
    items,
    specs: [...input.specs],
    history: input.history ?? [],
    layerRules: input.layerRules ?? [],
  };
  return { project, blockedItemIds };
}

/** ScubeProject → JSON 문자열 (순수, UTF-8) — @s-cube/schema 직렬화 위임(검증 포함) */
export function serializeProject(project: ScubeProject): string {
  return serializeScubeProject(project);
}

/** JSON 문자열 → 검증된 ScubeProject (순수) — parseScubeProject 위임 */
export function deserializeProject(text: string): ReturnType<typeof parseScubeProject> {
  try {
    JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 파싱 실패 — .scube 파일이 손상되었습니다' };
  }
  return parseScubeProject(text);
}

/**
 * 도면 무결성 대조 (P4-17) — 순수.
 *
 * 프로젝트에 저장된 도면 지문(contentHash)과 현재 열린 도면의 지문을 파일명 기준으로
 * 비교한다. 같은 이름인데 해시가 다르면 '도면이 바뀜' 경고를 만든다(참조 도면 교체·수정).
 * 현재 열린 도면이 없으면 경고 없음(열 때 확인).
 *
 * 한계(UI 노출): contentHash 는 파일 원본 SHA-256 이 아니라 정규화 후 지오메트리 기준 내용
 * 지문이다(웹은 원본 바이트 미보관 — storage.ts drawingContentHash 주석 참조). 좌표·도형이
 * 바뀌면 감지하지만, DXF 원본만 다르고 정규화 결과가 동일한 변경(주석·서식 등)은 지나칠 수
 * 있다. 경고 메시지는 '재확인' 을 권해 이 한계를 사용자에게 노출한다.
 */
export interface DrawingIntegrityWarning {
  fileName: string;
  /** 저장 당시 해시 */
  savedHash: string;
  /** 현재 열린 도면 해시 (없으면 '미열림') */
  currentHash: string | null;
  message: string;
}

export function checkDrawingIntegrity(
  savedDrawings: { fileName: string; contentHash: string }[],
  currentDrawings: { fileName: string; contentHash: string }[],
): DrawingIntegrityWarning[] {
  const currentByName = new Map(currentDrawings.map((d) => [d.fileName, d.contentHash]));
  const warnings: DrawingIntegrityWarning[] = [];
  for (const saved of savedDrawings) {
    const currentHash = currentByName.get(saved.fileName);
    if (currentHash === undefined) continue; // 아직 안 열림 — 열 때 대조
    if (currentHash !== saved.contentHash) {
      warnings.push({
        fileName: saved.fileName,
        savedHash: saved.contentHash,
        currentHash,
        message: `도면 '${saved.fileName}' 이 저장 당시와 다릅니다 — 교체·수정되었을 수 있으니 산출값을 재확인하세요`,
      });
    }
  }
  return warnings;
}

/** 문자열 role 을 DrawingRole 로 좁힘 (미상은 'other') */
export function toDrawingRole(role: string): DrawingRole {
  return (DRAWING_ROLES as readonly string[]).includes(role) ? (role as DrawingRole) : 'other';
}

// 도면 무결성 지문(P4-17)은 storage.ts 의 drawingContentHash 를 쓴다
// (파일명+엔티티 지오메트리 다이제스트+bounds — 도형만 바뀐 도면도 감지).
