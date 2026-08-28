import type { FormulaNode } from '@s-cube/schema';
import { fAvgEndArea, fConst, fLoss, fMul } from './formula.ts';

/**
 * 계산 유형별 FormulaNode 생성기 — docs/quantity-calc-taxonomy.md 8종 중
 * 도면 기하에서 만들어지는 유형. area/length 는 측정값 fConst 그대로,
 * ref 는 fRef/fSub/fSum 조합, manual 은 fConst 입력으로 처리한다.
 */

/**
 * section-length: 양단면평균법 V = (A1+A2)/2 × L → ㎥.
 * evaluate 결과는 기존 averageEndArea(a1_m2, a2_m2, length_m) 와 일치한다.
 */
export function sectionLength(a1_m2: number, a2_m2: number, length_m: number): FormulaNode {
  return fAvgEndArea(fConst(a1_m2, 'A1(㎡)'), fConst(a2_m2, 'A2(㎡)'), fConst(length_m, 'L(m)'));
}

/** area-thickness: 면적 × 두께 → ㎥ (표층 포설·쇄석포설 등, 두께는 규격에서) */
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

/** 할증 체이닝: node × (1 + rate) — 철근 3%, 쇄석자갈 4% 등 */
export function applyLoss(node: FormulaNode, rate: number): FormulaNode {
  return fLoss(node, rate);
}

/** 단위 환산 체이닝: node × factor — 단위중량(kg/m)·밀도(㎥→TON) 등 */
export function convertUnit(node: FormulaNode, factor: number, label: string): FormulaNode {
  return fMul(node, fConst(factor, label));
}
