/**
 * 수량산출서 엑셀 내보내기 (Phase 4-C 연동, P4-11~P4-14).
 *
 * 현재 앱 상태(측정·측점·구간·규격·항목)를 ScubeProject 로 조립해 @s-cube/xlsx 의
 * buildWorkbook(project) 에 넘기고, 결과(ArrayBuffer|Buffer)를 브라우저 다운로드한다.
 *
 * ExcelJS 는 반드시 @s-cube/xlsx 경유 — web 에서 직접 import 하지 않는다. 번들 비대화를
 * 막기 위해 buildWorkbook 은 동적 import 로 지연 로드한다(내보내기 버튼 클릭 시에만).
 * @s-cube/xlsx 가 아직 buildWorkbook 을 배포하지 않았으면(병렬 작업 중) 사용자에게 안내한다.
 *
 * 내보내기 전 검증(P4-11 연동): 캘리브레이션 미완료·결측(전 결측 차단) 구간이 있으면 경고를
 * 만든다 — 진행 여부는 사용자가 선택한다(강제 차단 아님).
 */
import type { AppState } from '../store/types.ts';
import { collectProjectDrawings } from './project-collect.ts';
import { assembleProject, type ProjectAssemblyInput } from './project-io.ts';
import type { ScubeProject } from './project-schema.ts';
import { buildSegments, totalVolume } from './station-derive.ts';

/**
 * buildWorkbook 계약 — @s-cube/xlsx (동적 import 대상, 값 미노출 대비 로컬 타입).
 * ScubeProject 는 @s-cube/schema 별칭(project-schema)이므로 @s-cube/xlsx buildWorkbook 의
 * 실제 입력 타입과 일치한다 — 로컬/스키마 포맷 분기 없음(finding 5 해소).
 */
type BuildWorkbook = (project: ScubeProject) => Promise<ArrayBuffer | Uint8Array>;

/** 내보내기 전 경고 한 건 */
export interface ExportWarning {
  kind: 'no-calibration' | 'blocked-section' | 'blocked-item' | 'empty';
  message: string;
}

/**
 * 내보내기 전 검증 (순수) — 상태에서 경고 목록을 만든다.
 *
 * - no-calibration: 캘리브레이션 안 된 도면이 있으면(측정값이 축척 미반영일 수 있음).
 * - blocked-section: 전 결측 등으로 buildSegments 가 blocked 인 itemKey.
 * - blocked-item: basis 가 null(차단)인 산출 항목.
 * - empty: 산출 항목이 하나도 없음.
 */
export function validateBeforeExport(state: {
  drawings: { fileName: string; calibration: AppState['calibration'] }[];
  sections: AppState['sections'];
  itemKeys: string[];
  items: AppState['items'];
}): ExportWarning[] {
  const warnings: ExportWarning[] = [];

  const uncalibrated = state.drawings.filter((d) => d.calibration === null);
  if (uncalibrated.length > 0) {
    warnings.push({
      kind: 'no-calibration',
      message: `캘리브레이션이 안 된 도면 ${uncalibrated.length}개가 있습니다 — 측정값이 축척 미반영일 수 있습니다 (${uncalibrated
        .map((d) => d.fileName)
        .join(', ')})`,
    });
  }

  for (const key of state.itemKeys) {
    const result = buildSegments(state.sections, key);
    if (result.blocked) {
      warnings.push({
        kind: 'blocked-section',
        message: `'${key}' 구간에 전 결측이 있어 체적 산출이 차단됩니다 — 누락 단면을 채운 뒤 내보내세요`,
      });
    }
    // totalVolume 를 부르지 않으면 blocked 만 검사해도 되지만, 명시적으로 확인.
    void totalVolume(result);
  }

  const blockedItems = state.items.filter((it) => it.blocked);
  if (blockedItems.length > 0) {
    warnings.push({
      kind: 'blocked-item',
      message: `산출 차단된 항목 ${blockedItems.length}개는 내보내기에서 제외됩니다 (${blockedItems
        .map((it) => it.name)
        .join(', ')})`,
    });
  }

  if (state.items.length === 0) {
    warnings.push({ kind: 'empty', message: '산출 항목이 없습니다 — 먼저 항목을 추가하세요' });
  }

  return warnings;
}

/** 현재 스토어 상태 → ProjectAssemblyInput (부수효과 없음, drawings 수집만 storage 사용) */
export function assemblyInputFromState(state: AppState): ProjectAssemblyInput {
  return {
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
  };
}

/** ArrayBuffer|Uint8Array → Blob 다운로드 (부수효과) */
export function downloadBlob(data: ArrayBuffer | Uint8Array, fileName: string, mime: string): void {
  const part: BlobPart = data instanceof Uint8Array ? new Uint8Array(data) : data;
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다음 틱에 revoke — 즉시 revoke 하면 일부 브라우저에서 다운로드가 취소된다.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** .xlsx 파일명 — 프로젝트명(없으면 기본) + 날짜 */
export function xlsxFileName(projectName: string, now: Date): string {
  const base = projectName.trim() !== '' ? projectName.trim() : '수량산출서';
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${base}_${y}${m}${d}.xlsx`;
}

/**
 * @s-cube/xlsx 의 buildWorkbook 을 동적 로드한다. 아직 미배포면 null.
 * 정적 import 를 피해(값 미노출 대비) 번들·타입 양쪽을 안전하게 유지한다.
 */
async function loadBuildWorkbook(): Promise<BuildWorkbook | null> {
  try {
    const mod = (await import('@s-cube/xlsx')) as Record<string, unknown>;
    const fn = mod.buildWorkbook;
    return typeof fn === 'function' ? (fn as BuildWorkbook) : null;
  } catch {
    return null;
  }
}

/** 내보내기 결과 */
export type ExportResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: 'no-builder' | 'error'; message: string };

/**
 * 상태 → ScubeProject 조립 → buildWorkbook → 다운로드 (부수효과 오케스트레이터).
 * 검증 경고는 이 함수 전에 UI 가 확인한다(진행은 사용자 선택). 여기서는 실제 생성·다운로드만.
 */
export async function exportWorkbook(state: AppState): Promise<ExportResult> {
  const now = new Date();
  const { project } = assembleProject(assemblyInputFromState(state), now.toISOString());

  const buildWorkbook = await loadBuildWorkbook();
  if (buildWorkbook === null) {
    return {
      ok: false,
      reason: 'no-builder',
      message: '엑셀 생성기(@s-cube/xlsx)가 아직 준비되지 않았습니다 — 잠시 후 다시 시도하세요',
    };
  }

  try {
    const data = await buildWorkbook(project);
    const fileName = xlsxFileName(state.projectName, now);
    downloadBlob(
      data,
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return { ok: true, fileName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'error', message: `엑셀 생성 실패: ${message}` };
  }
}
