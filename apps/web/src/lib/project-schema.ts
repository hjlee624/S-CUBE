/**
 * ScubeProject (.scube) — @s-cube/schema 위임 (Phase 4-D, 03-DATA-MODEL §7).
 *
 * 단일 진실원천: 프로젝트 봉투(schemaVersion·meta·drawings·measurements·sections·items·
 * specs·history)의 형태·검증은 전부 @s-cube/schema 의 ScubeProjectSchema 가 갖는다. 이
 * 파일은 앱이 쓰기 좋은 타입 별칭과, 에러를 사람이 읽는 문자열로 감싸는 파서 래퍼만 둔다
 * (예전에는 zod 의존 회피를 위해 로컬 봉투를 손으로 검증했으나, 이제 web 이 @s-cube/schema
 * 에 의존하므로 로컬 포맷 분기를 제거해 두 진실원천이 갈라지지 않게 한다).
 *
 * 도면 무결성(P4-17): DrawingRef.contentHash 가 도면 내용 지문이다. 웹은 원본 파일 바이트를
 * 보관하지 않으므로 파일 원본 SHA-256 이 아니라 (파일명+엔티티지오메트리+bounds) 내용 해시를
 * 쓴다 — 엔티티 수·bounds 가 같아도 도형이 바뀌면 달라져 교체·수정을 감지한다. 이 한계는
 * project-file 열기 경로가 사용자에게 안내한다.
 */
import {
  type DrawingRef,
  parseScubeProject as parseScubeProjectSchema,
  type ScubeProject as SchemaScubeProject,
  type ScubeProjectMeta,
  serializeScubeProject as serializeScubeProjectSchema,
} from '@s-cube/schema';

/** .scube 에 담는 도면 참조 (03-DATA-MODEL §7) — @s-cube/schema DrawingRef 별칭 */
export type ProjectDrawing = DrawingRef;

/** 프로젝트 메타 (03-DATA-MODEL §7) — @s-cube/schema ScubeProjectMeta 별칭 */
export type ProjectMeta = ScubeProjectMeta;

/** .scube 프로젝트 파일 (03-DATA-MODEL §7) — @s-cube/schema ScubeProject 별칭 */
export type ScubeProject = SchemaScubeProject;

/** 파싱 성공/실패 결과 — 실패 사유를 사람이 읽는 문자열로 노출 */
export type ParseProjectResult = { ok: true; project: ScubeProject } | { ok: false; error: string };

/**
 * unknown → ScubeProject 검증 (03-DATA-MODEL §7) — @s-cube/schema 위임.
 *
 * @s-cube/schema 의 parseScubeProject 는 상위 버전·손상을 에러로 던진다(조용한 손실 금지).
 * 여기서는 그 에러를 사람이 읽는 문자열로 감싸 UI 가 토스트로 노출하게 한다.
 */
export function parseScubeProject(raw: unknown): ParseProjectResult {
  try {
    const project = parseScubeProjectSchema(typeof raw === 'string' ? raw : JSON.stringify(raw));
    return { ok: true, project };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `프로젝트 검증 실패: ${message}` };
  }
}

/** ScubeProject → JSON 문자열 (UTF-8, 2칸 들여쓰기) — @s-cube/schema 위임 */
export function serializeScubeProject(project: ScubeProject): string {
  return serializeScubeProjectSchema(project);
}
