import type { CalcType, FormulaNode } from '@s-cube/schema';
import { fAvgEndArea, fConst, fLoss, fMul } from './formula.ts';

/**
 * 계산 유형별 FormulaNode 생성기 — docs/quantity-calc-taxonomy.md 8종 중
 * 도면 기하에서 만들어지는 유형. area/length 는 측정값 fConst 그대로,
 * ref 는 fRef/fSub/fSum 조합, manual 은 fConst 입력으로 처리한다.
 */

/**
 * 빌더 이름 — CALC_TYPE_OF 의 키. 4개 기하 빌더만 노출한다(area/length 는 측정값 직결,
 * ref/manual 은 직교 수식자이므로 전용 빌더가 없다 — 매핑은 CALC_TYPE_OF 주석 참조).
 */
export const CALC_BUILDERS = [
  'sectionLength',
  'areaThickness',
  'contactLength',
  'countTimes',
] as const;

export type CalcBuilderName = (typeof CALC_BUILDERS)[number];

/**
 * 빌더 → CalcType 매핑 (RW-7, P4-9-2) — docs/quantity-calc-taxonomy.md 8유형과 1:1 대조용.
 *
 * 기하 빌더 4개만 직접 매핑된다:
 *   sectionLength → 'section-length', areaThickness → 'area-thickness',
 *   contactLength → 'contact-length', countTimes → 'count'.
 * 나머지 4유형은 전용 빌더 없이 조립된다:
 *   'area'/'length'  = 측정값 직결(fRef/fConst, 빌더 불필요),
 *   'ref'            = fRef/fSub/fSum + applyLoss/convertUnit 조합,
 *   'manual'         = fConst 입력.
 * 이 상수는 "빌더가 곧 유형" 임을 코드로 못박아, 문서 대조 테스트가 커버리지를 고정한다.
 */
export const CALC_TYPE_OF: Readonly<Record<CalcBuilderName, CalcType>> = {
  sectionLength: 'section-length',
  areaThickness: 'area-thickness',
  contactLength: 'contact-length',
  countTimes: 'count',
};

/**
 * section-length: 양단면평균법 V = (A1+A2)/2 × L → ㎥.
 * evaluate 결과는 기존 averageEndArea(a1_m2, a2_m2, length_m) 와 일치한다.
 */
export function sectionLength(a1_m2: number, a2_m2: number, length_m: number): FormulaNode {
  return fAvgEndArea(fConst(a1_m2, 'A1(㎡)'), fConst(a2_m2, 'A2(㎡)'), fConst(length_m, 'L(m)'));
}

/**
 * area-thickness: 면적 × 두께 → ㎥ (표층 포설·쇄석포설 등).
 * 두께는 **MaterialSpec.thickness_m 에서** 온다(RW-6) — 호출측이 규격 두께를 넘긴다.
 * 하드코딩 두께(0.1 등)는 금지: 두께 없는 규격은 호출측에서 산출을 차단한다.
 */
export function areaThickness(area_m2: number, thickness_m: number): FormulaNode {
  return fMul(fConst(area_m2, '면적(㎡)'), fConst(thickness_m, '두께(m)'));
}

/** contact-length: 접촉폭(둘레) × 연장 → ㎡ (거푸집·비계 파생 면적) */
export function contactLength(contactWidth_m: number, length_m: number): FormulaNode {
  return fMul(fConst(contactWidth_m, '접촉폭(m)'), fConst(length_m, '연장(m)'));
}

/** count: 개수 (× 단위계수 — 개소당 길이·회당 수량 등) */
export function countTimes(count: number, per?: number): FormulaNode {
  return per === undefined
    ? fConst(count, '개수')
    : fMul(fConst(count, '개수'), fConst(per, '단위계수'));
}

/**
 * 파생 접촉면(거푸집) — 기준 콘크리트 항목의 단면 둘레(접촉변) × 구간 연장 → ㎡ (RW-5).
 * perimeterNode 는 기준 항목의 단면 폴리라인 둘레를 가리키는 fRef(살아 있는 참조).
 * v1 은 전체 둘레(바닥/상단 제외 세분은 후속) — 계수 손입력 폐지, 도면 기하에서만 온다.
 */
export function derivedContact(perimeterNode: FormulaNode, length_m: number): FormulaNode {
  return fMul(perimeterNode, fConst(length_m));
}

/**
 * 파생 비계(시스템비계) — 구조물 외곽 둘레 × 높이 → ㎡ (RW-5).
 * perimeterNode 는 외곽 둘레 fRef, height_m 는 사용자가 넣는 단일 높이 입력.
 */
export function derivedScaffold(perimeterNode: FormulaNode, height_m: number): FormulaNode {
  return fMul(perimeterNode, fConst(height_m));
}

/**
 * 파생 동바리(시스템/목재 동바리) — 바닥 수평 면적 × 높이(타설고) → 공㎥ (RW-5).
 * areaNode 는 바닥 수평 면적 fRef, height_m 는 타설고 단일 입력.
 */
export function derivedShore(areaNode: FormulaNode, height_m: number): FormulaNode {
  return fMul(areaNode, fConst(height_m));
}

/** 할증 체이닝: node × (1 + rate) — 철근 3%, 쇄석자갈 4% 등 */
export function applyLoss(node: FormulaNode, rate: number): FormulaNode {
  return fLoss(node, rate);
}

/** 단위 환산 체이닝: node × factor — 단위중량(kg/m)·밀도(㎥→TON) 등 */
export function convertUnit(node: FormulaNode, factor: number, label: string): FormulaNode {
  return fMul(node, fConst(factor, label));
}
