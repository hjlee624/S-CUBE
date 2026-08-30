import type { DrawingRole, TakeoffKind } from '@s-cube/schema';

/**
 * 산출 전 필수 도면 요구사항 (Requirement).
 *
 * anyOf 중 하나라도 있으면 그 요구사항은 충족된 것으로 본다.
 * necessity 'required' 는 없으면 산출이 부정확·불가하다는 경고(warn),
 * 'recommended' 는 있으면 좋은 보조 도면이다.
 *
 * 설계 철학: 체크리스트는 강제 차단(block)이 아니라 안내(warn)다.
 * 사람이 판단하고, 도구는 무엇이 빠졌는지 이유와 함께 기록만 한다.
 */
export interface Requirement {
  /** 이 중 하나라도 present 면 요구사항 충족 */
  anyOf: DrawingRole[];
  necessity: 'required' | 'recommended';
  /** 왜 이 도면이 필요한가 (한국어 설명) */
  reason: string;
}

/**
 * 산출 방식별 필수·권장 도면 요구사항.
 *
 * - earthwork-section(양단면평균법): 횡단면도로 단면적을 얻고(필수),
 *   종단/평면도로 측점·연장을 확인한다(권장).
 * - structure(구조물): 횡단면도 또는 표준·상세도로 단면을 얻고(필수),
 *   평면도로 위치·연장을 확인한다(권장).
 * - area(면적): 평면도 또는 횡단면도로 폐합영역을 얻는다(필수).
 * - linear(연장): 평면도 또는 종단면도로 선형 연장을 얻는다(필수).
 */
export const TAKEOFF_REQUIREMENTS: Record<TakeoffKind, Requirement[]> = {
  'earthwork-section': [
    { anyOf: ['cross-section'], necessity: 'required', reason: '단면적(A1·A2) 취득' },
    { anyOf: ['profile', 'plan'], necessity: 'recommended', reason: '측점·구간 연장 확인' },
  ],
  structure: [
    {
      anyOf: ['cross-section', 'standard-detail'],
      necessity: 'required',
      reason: '구조물 단면 취득',
    },
    { anyOf: ['plan'], necessity: 'recommended', reason: '위치·연장 확인' },
  ],
  area: [{ anyOf: ['plan', 'cross-section'], necessity: 'required', reason: '폐합 영역 취득' }],
  linear: [{ anyOf: ['plan', 'profile'], necessity: 'required', reason: '선형 연장 취득' }],
};

/** 개별 요구사항 평가 결과 — Requirement + 충족 여부/충족한 역할들 */
export interface ChecklistItem {
  anyOf: DrawingRole[];
  necessity: 'required' | 'recommended';
  reason: string;
  /** anyOf ∩ presentRoles ≠ ∅ */
  present: boolean;
  /** anyOf 중 실제로 존재한 역할들 (중복 제거) */
  presentRoles: DrawingRole[];
}

/** 체크리스트 전체 평가 결과 */
export interface ChecklistResult {
  kind: TakeoffKind;
  /** 모든 required 항목이 present 인가 (recommended 미충족은 satisfied 에 영향 없음) */
  satisfied: boolean;
  items: ChecklistItem[];
  /** 충족되지 못한 required 요구사항들 */
  missingRequired: Requirement[];
}

/**
 * 산출 방식(kind)과 현재 보유 도면 역할(presentRoles)로 체크리스트를 평가한다.
 *
 * 순수 함수 — 입력을 변경하지 않는다.
 * - present = 요구사항 anyOf ∩ presentRoles ≠ ∅
 * - satisfied = 모든 required 항목이 present
 *
 * @param kind 산출 방식
 * @param presentRoles 현재 워크스페이스에 존재하는 도면 역할들 (중복 허용, 내부에서 처리)
 */
export function evaluateChecklist(kind: TakeoffKind, presentRoles: DrawingRole[]): ChecklistResult {
  const presentSet = new Set(presentRoles);
  const requirements = TAKEOFF_REQUIREMENTS[kind];

  const items: ChecklistItem[] = requirements.map((req) => {
    const matched = req.anyOf.filter((role) => presentSet.has(role));
    return {
      anyOf: req.anyOf,
      necessity: req.necessity,
      reason: req.reason,
      present: matched.length > 0,
      presentRoles: matched,
    };
  });

  const missingRequired = requirements.filter((req, i) => {
    const item = items[i];
    return req.necessity === 'required' && item !== undefined && !item.present;
  });

  const satisfied = missingRequired.length === 0;

  return { kind, satisfied, items, missingRequired };
}
