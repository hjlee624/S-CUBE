/**
 * workspace/ — 도면 역할 분류 + 산출 전 필수도면 체크리스트
 *
 * 반자동 원칙: 사람이 판단, 도구가 계산·기록. 체크리스트는 경고(warn)이지
 * 강제 차단(block)이 아니다. 필요 도면이 무엇이고 왜 필요한지 안내만 한다.
 */

export {
  type ChecklistItem,
  type ChecklistResult,
  evaluateChecklist,
  type Requirement,
  TAKEOFF_REQUIREMENTS,
} from './checklist.ts';
export { suggestRoleFromName } from './roles.ts';
