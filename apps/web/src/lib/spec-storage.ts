/**
 * 규격 마스터 localStorage 영속 + JSON 가져오기/내보내기 (Phase 4-A, P4-5·P4-6).
 *
 * 03-DATA-MODEL 의 ~/.s-cube/specs.json 을 브라우저에서 localStorage(키 s-cube:specs)로
 * 대체한다. 저장·복원 시 @s-cube/schema 의 MaterialSpecSchema 로 검증해 손상 데이터가
 * 스토어에 들어가지 않게 못박는다(손상 시 조용히 무시 → 프리셋으로 복귀).
 *
 * 순수 직렬화/역직렬화(parseSpecsJson·serializeSpecsJson)는 localStorage 에 의존하지 않아
 * 단위 테스트 가능하다.
 */
import { type MaterialSpec, MaterialSpecSchema } from '@s-cube/schema';

/** 규격 마스터 localStorage 키 */
export const SPECS_STORAGE_KEY = 's-cube:specs';

/** JSON 문자열 → MaterialSpec[] 검증 (순수). 실패 시 null (손상 무시) */
export function parseSpecsJson(text: string): MaterialSpec[] | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return null;
    // 각 항목을 개별 검증 — 하나라도 손상이면 전체 실패로 취급(부분 로드 금지).
    const specs = raw.map((item) => MaterialSpecSchema.parse(item));
    return specs;
  } catch {
    return null;
  }
}

/** MaterialSpec[] → JSON 문자열 (순수, 사람이 읽기 좋게 2칸 들여쓰기) */
export function serializeSpecsJson(specs: MaterialSpec[]): string {
  return JSON.stringify(specs, null, 2);
}

/** localStorage 에서 복원 — 없거나 손상 시 null */
export function loadSpecs(): MaterialSpec[] | null {
  try {
    const raw = localStorage.getItem(SPECS_STORAGE_KEY);
    if (raw === null) return null;
    return parseSpecsJson(raw);
  } catch {
    return null;
  }
}

/** localStorage 에 저장 — 검증 후 직렬화. 실패 시 false */
export function saveSpecs(specs: MaterialSpec[]): boolean {
  try {
    // 저장 전 각 항목 재검증 (스토어에 잘못 들어온 값 차단)
    const validated = specs.map((s) => MaterialSpecSchema.parse(s));
    localStorage.setItem(SPECS_STORAGE_KEY, serializeSpecsJson(validated));
    return true;
  } catch {
    return false;
  }
}
