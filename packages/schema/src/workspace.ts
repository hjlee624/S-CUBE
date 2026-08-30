import { z } from 'zod';

/**
 * 도면 역할 (드로잉 role) — 한 장의 도면이 수량 산출에서 담당하는 정보.
 *
 * 수량 산출은 도면 한 장으로 부족하다. 양단면평균법은 횡단면도(단면적)와
 * 종단/평면도(측점·연장)가 함께 필요하고, 옹벽 등 구조물은 평면(위치·연장)과
 * 횡단/표준도(단면)가 함께 필요하다. 역할을 분류해 필요 도면을 안내하기 위한 축.
 *
 * - plan:            평면도 (위치·선형·폐합영역)
 * - profile:         종단면도 (측점·구간 연장)
 * - cross-section:   횡단면도 (단면적 A1·A2)
 * - standard-detail: 표준·상세도 (구조물 단면·치수)
 * - other:           그 외 (역할 미상)
 */
export const DRAWING_ROLES = [
  'plan',
  'profile',
  'cross-section',
  'standard-detail',
  'other',
] as const;

export type DrawingRole = (typeof DRAWING_ROLES)[number];

export const DrawingRoleSchema = z.enum(DRAWING_ROLES);

/** 도면 역할 한국어 라벨 (UI 표시용) */
export const DRAWING_ROLE_LABELS: Record<DrawingRole, string> = {
  plan: '평면도',
  profile: '종단면도',
  'cross-section': '횡단면도',
  'standard-detail': '표준·상세도',
  other: '기타',
};

/**
 * 수량 산출 방식 (takeoff kind) — 어떤 종류의 물량을 뽑는가.
 *
 * 산출 방식마다 필요한 도면 역할이 다르다 (checklist.ts TAKEOFF_REQUIREMENTS).
 *
 * - earthwork-section: 선형 토공 / 양단면평균법 (단면적 × 연장 → ㎥)
 * - structure:         구조물 (옹벽·암거 등, 단면 + 위치)
 * - area:              면적 물량 (폐합영역 → ㎡)
 * - linear:            연장 물량 (선형 길이 → m)
 */
export const TAKEOFF_KINDS = ['earthwork-section', 'structure', 'area', 'linear'] as const;

export type TakeoffKind = (typeof TAKEOFF_KINDS)[number];

export const TakeoffKindSchema = z.enum(TAKEOFF_KINDS);

/** 산출 방식 한국어 라벨 (UI 표시용) */
export const TAKEOFF_KIND_LABELS: Record<TakeoffKind, string> = {
  'earthwork-section': '선형 토공(양단면평균법)',
  structure: '구조물',
  area: '면적 물량',
  linear: '연장 물량',
};
