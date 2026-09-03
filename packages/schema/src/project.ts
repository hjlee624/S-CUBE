import { z } from 'zod';
import { CalibrationSchema } from './calibration.ts';
import { MeasurementSchema } from './measurement.ts';
import { CalcTypeSchema, MaterialSpecSchema, TakeoffItemSchema } from './quantity.ts';
import { StationSectionSchema } from './station.ts';
import { SCHEMA_VERSION } from './version.ts';
import { DrawingRoleSchema } from './workspace.ts';

/**
 * .scube 프로젝트 파일 (03-DATA-MODEL §7) — 단일 진실원천.
 *
 * 도면 원본은 임베드하지 않는다 — 참조 정보 + 무결성 지문만 저장하고
 * 로드 시 지문으로 교체·수정을 감지한다 (P4-17, 21-CONVENTIONS §7).
 * JSON, UTF-8. Zod 로 로드 시 검증하고 schemaVersion 마이그레이션 경로를 둔다.
 *
 * apps/web 은 이 스키마(ScubeProjectSchema/parseScubeProject/serializeScubeProject)에
 * 위임한다 — 로컬 포맷 분기를 두지 않는다(두 진실원천 갈라짐 방지).
 */

/**
 * 프로젝트에 참여한 도면의 참조 정보 (임베드 X).
 *
 * 정규화된 엔티티(DrawingModel)는 무겁고 재파싱 가능하므로 저장하지 않는다.
 * 대신 재열기·무결성 검증·UI 복원에 필요한 최소 정보만 저장한다.
 *
 * 무결성(P4-17): contentHash 는 도면 내용 지문이다. 웹 앱은 원본 파일 바이트를 보관하지
 * 않고 정규화 엔티티만 들고 있으므로, 파일 원본 SHA-256 대신 (파일명 + 엔티티 지오메트리
 * 다이제스트 + bounds) 로 만든 내용 해시를 쓴다 — 엔티티 수·bounds 가 같아도 도형이 바뀌면
 * 달라져 교체·수정을 감지한다. 서버/CLI 경로가 원본 바이트를 가질 때는 sha256(선택)에
 * 파일 원본 해시를 채워 더 강한 무결성 근거를 남길 수 있다(한계는 UI 가 노출).
 */
export const DrawingRefSchema = z.object({
  /** 도면 식별자 (uuid) */
  id: z.string().min(1),
  fileName: z.string().min(1),
  /** 도면 역할 (평면도·종단면도 등) — UI 복원용 */
  role: DrawingRoleSchema.default('other'),
  /** 정규화 엔티티 수 (지문 성분·표시용) */
  entityCount: z.number().int().nonnegative().default(0),
  /** 도면 내용 지문 — 교체·수정 감지 (P4-17). 파일명+엔티티지오메트리+bounds 해시 */
  contentHash: z.string().min(1),
  /** 절대경로 — 원본을 다시 읽을 때 사용 (임베드 안 함, 웹은 없을 수 있음) */
  filePath: z.string().optional(),
  /** 파일 원본 SHA-256 — 서버/CLI 경로에서만(웹은 원본 바이트 미보관). 있으면 강한 무결성 */
  sha256: z.string().optional(),
  /** AC1015 등 $ACADVER 원값 */
  dxfVersion: z.string().default(''),
  /** $INSUNITS 원값 */
  insUnits: z.number().int().default(0),
  /** 도면별 캘리브레이션 (UI 복원용) — 미설정이면 null */
  calibration: CalibrationSchema.nullable().default(null),
  /** 레이어 표시 상태 (UI 복원용) */
  layers: z
    .array(
      z.object({
        name: z.string(),
        colorIndex: z.number().int(),
        visible: z.boolean(),
        entityCount: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  /** 마지막으로 로드한 시각 (ISO8601, 선택) */
  loadedAt: z.string().optional(),
});

export type DrawingRef = z.infer<typeof DrawingRefSchema>;

/**
 * 변경 이력 한 건 — 재계산·수정의 역추적용 (P4-10, P4-18 자동 저장 복구).
 * detail 은 자유 형식 요약 문자열 (예: "측정 m-3 수정: 12.5 → 13.1 ㎡").
 */
export const ChangeLogEntrySchema = z.object({
  /** 이력 식별자 */
  id: z.string().min(1),
  /** 발생 시각 (ISO8601) */
  at: z.string(),
  /** 행위자 (사용자명 또는 'system') */
  actor: z.string(),
  /**
   * 변경 종류.
   * - measurement: 측정 추가·수정·삭제
   * - section:     측점 단면 변경
   * - item:        산출 항목 변경
   * - spec:        규격 마스터 변경
   * - drawing:     도면 추가·교체
   * - project:     프로젝트 메타 변경
   */
  kind: z.enum(['measurement', 'section', 'item', 'spec', 'drawing', 'project']),
  /** 대상 엔티티 id (있으면) */
  targetId: z.string().optional(),
  /** 사람이 읽는 변경 요약 */
  detail: z.string(),
});

export type ChangeLogEntry = z.infer<typeof ChangeLogEntrySchema>;

/** 프로젝트 메타 정보 (03-DATA-MODEL §7) */
export const ScubeProjectMetaSchema = z.object({
  /** 프로젝트명 (예: '곡성 지구 도로확포장') */
  projectName: z.string().min(1),
  author: z.string(),
  /** 생성 시각 (ISO8601) */
  createdAt: z.string(),
  /** 최종 수정 시각 (ISO8601) */
  updatedAt: z.string(),
  /** 측점 간격 (m) — 통상 20 */
  stationInterval_m: z.number().positive(),
  /** 검토자 (표지용, 선택) */
  reviewer: z.string().optional(),
  /** 도면번호 (표지용, 선택) */
  drawingNo: z.string().optional(),
});

export type ScubeProjectMeta = z.infer<typeof ScubeProjectMetaSchema>;

/**
 * 레이어 → 항목 매핑 규칙 (P5-7/8, RW-14).
 *
 * 레이어 이름 패턴에 매칭되는 엔티티를 지정 CalcType 항목 후보로 자동 그룹핑한다.
 * 규칙이 없어도 객체 기반 경로(groupBySimilarity)가 기본 동작한다(보조 가속 수단).
 */
export const LayerRuleSchema = z.object({
  /** 고유 식별자 */
  id: z.string().min(1),
  /** 레이어 이름 패턴 — glob (* = 0개 이상 문자, ? = 1개 문자, 대소문자 무시) */
  pattern: z.string().min(1),
  /** 이 규칙으로 생성할 항목의 계산 유형 */
  calcType: CalcTypeSchema,
  /** 자동 할당할 규격 코드 (없으면 사용자가 직접 선택) */
  specCode: z.string().optional(),
  /** 항목 라벨 (없으면 레이어명 사용) */
  label: z.string().optional(),
  /** 메모 */
  note: z.string().optional(),
});

export type LayerRule = z.infer<typeof LayerRuleSchema>;

/**
 * .scube 프로젝트 (03-DATA-MODEL §7).
 * schemaVersion 은 리터럴 1 — 상위 버전은 migrateScubeProject 에서 다운/업 변환한다.
 */
export const ScubeProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: ScubeProjectMetaSchema,
  drawings: z.array(DrawingRefSchema),
  measurements: z.array(MeasurementSchema),
  sections: z.array(StationSectionSchema),
  items: z.array(TakeoffItemSchema),
  specs: z.array(MaterialSpecSchema),
  history: z.array(ChangeLogEntrySchema),
  /** 레이어 규칙 — 레이어명 패턴 → 항목 자동 후보 (P5-7/8). 없으면 [] */
  layerRules: z.array(LayerRuleSchema).optional().default([]),
});

export type ScubeProject = z.infer<typeof ScubeProjectSchema>;

/**
 * 로드 시 마이그레이션 훅 자리 (03-DATA-MODEL §7).
 *
 * 아직 버전은 1 하나뿐이라 실질 변환은 없지만, 미래 스키마 진화 시
 * 여기서 이전 버전 raw 를 최신 형태로 끌어올린 뒤 ScubeProjectSchema.parse 한다.
 * 알 수 없는(미래) 버전은 에러로 승격해 조용한 데이터 손실을 막는다.
 */
export function migrateScubeProject(raw: unknown): ScubeProject {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) {
    throw new Error(
      '.scube: schemaVersion 필드가 없습니다 — 손상되었거나 지원하지 않는 파일입니다',
    );
  }
  const version = (raw as { schemaVersion: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    throw new Error('.scube: schemaVersion 이 숫자가 아닙니다');
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `.scube: 지원하지 않는 상위 스키마 버전 ${version} (지원: ${SCHEMA_VERSION}) — S-CUBE 를 업데이트하세요`,
    );
  }
  // 버전 1 → 1: 변환 없음. (미래 버전 승급 로직을 여기 체이닝한다.)
  return ScubeProjectSchema.parse(raw);
}

/** 프로젝트 JSON 직렬화 (UTF-8, pretty). 저장 경계에서만 사용 */
export function serializeScubeProject(project: ScubeProject): string {
  return JSON.stringify(ScubeProjectSchema.parse(project), null, 2);
}

/** 프로젝트 JSON 역직렬화 + 마이그레이션 + 검증 */
export function parseScubeProject(json: string): ScubeProject {
  return migrateScubeProject(JSON.parse(json));
}
