/**
 * .scube 저장/열기 오케스트레이터 (Phase 4-D) — 부수효과(다운로드·파일 선택·상태 반영).
 *
 * 순수 조립/역조립은 project-io.ts, 순수 검증은 project-schema.ts 가 담당한다. 여기서는
 * 그 순수 함수들을 브라우저 파일 IO 와 zustand 스토어에 연결만 한다.
 *
 * 복원 시 P4-17 무결성 대조: 저장된 도면 지문과 현재 열린 도면 지문을 파일명 기준으로
 * 비교해 바뀐 도면이 있으면 토스트 경고한다(참조 도면 교체·수정 감지).
 */
import { useAppStore } from '../store/index.ts';
import { downloadBlob } from './export-xlsx.ts';
import { collectProjectDrawings, currentDrawingHashes } from './project-collect.ts';
import {
  assembleProject,
  checkDrawingIntegrity,
  deserializeProject,
  serializeProject,
} from './project-io.ts';
import { restoreEditableItems } from './takeoff-derive.ts';

/** .scube 파일명 — 프로젝트명(없으면 기본) + 날짜 */
export function scubeFileName(projectName: string, now: Date): string {
  const base = projectName.trim() !== '' ? projectName.trim() : '프로젝트';
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${base}_${y}${m}${d}.scube`;
}

/** 현재 상태를 .scube 로 다운로드 (P4-16) */
export function saveProjectFile(): void {
  const state = useAppStore.getState();
  const now = new Date();
  const { project, blockedItemIds } = assembleProject(
    {
      meta: {
        projectName: state.projectName,
        author: state.author,
        stationInterval_m: state.stationInterval_m,
      },
      drawings: collectProjectDrawings(state),
      measurements: state.measurements,
      sections: state.sections,
      specs: state.specs,
      items: state.items,
      existingCreatedAt: state.createdAt,
    },
    now.toISOString(),
  );

  const text = serializeProject(project);
  const encoder = new TextEncoder();
  downloadBlob(encoder.encode(text), scubeFileName(state.projectName, now), 'application/json');

  const note = blockedItemIds.length > 0 ? ` (산출 차단 항목 ${blockedItemIds.length}개 제외)` : '';
  state.showToast(`프로젝트 저장 완료${note}`, 'success');
}

/** 파일 선택 다이얼로그 → 열기 */
export function pickProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.scube,.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    const text = await file.text();
    openProjectText(text);
  };
  input.click();
}

/**
 * .scube 텍스트를 열어 상태를 복원한다 (P4-16·P4-17).
 *
 * 도면 정규화 엔티티는 .scube 에 임베드하지 않으므로(원본 참조), 이 복원은 측정·측점·규격·
 * 항목·메타만 되살린다. 도면 자체는 사용자가 다시 열어야 하며, 열린 도면과 저장 지문을
 * 대조해 바뀐 도면이 있으면 경고한다. 도면 캘리브레이션은 storage(localStorage) 복원 경로가
 * 별도로 담당한다(도면 재열기 시 자동).
 */
export function openProjectText(text: string): void {
  const store = useAppStore.getState();
  const result = deserializeProject(text);
  if (!result.ok) {
    store.showToast(result.error, 'error');
    return;
  }
  const project = result.project;

  // 규격·측정·측점·메타 복원.
  store.replaceSpecs(project.specs);
  store.setProjectName(project.meta.projectName);
  store.setAuthor(project.meta.author);
  store.setStationInterval(project.meta.stationInterval_m);

  // 측정·측점은 슬라이스에 직접 반영 (복원 경로 전용 set).
  useAppStore.setState({
    measurements: project.measurements,
    sections: project.sections,
    createdAt: project.meta.createdAt,
  });

  // 산출 항목 복원 — schema TakeoffItem → EditableTakeoffItem.
  // .scube 는 편집용 source 메타를 담지 않으므로(schema TakeoffItem 필드만), 복원 항목은
  // 저장된 basis·quantity 를 그대로 보존하는 수동 소스로 되살린다 — 산출근거·값이 그대로
  // 렌더·재export 된다. 원본(측정·구간) 재연결은 사용자가 다시 소스를 지정하면 재개된다.
  const items = restoreEditableItems(project.items, project.specs);
  store.replaceTakeoffItems(items);

  // 도면 무결성 대조 (P4-17) — 현재 열린 도면과 저장 지문 비교.
  const warnings = checkDrawingIntegrity(
    project.drawings.map((d) => ({ fileName: d.fileName, contentHash: d.contentHash })),
    currentDrawingHashes(useAppStore.getState()),
  );
  if (warnings.length > 0) {
    store.showToast(warnings[0]?.message ?? '도면이 변경되었습니다', 'warn');
  } else {
    store.showToast(`프로젝트 불러오기 완료 — 항목 ${items.length}개`, 'success');
  }
}
