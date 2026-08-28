import { describe, expect, it } from 'vitest';
import {
  evaluate,
  fAdd,
  fAvgEndArea,
  fConst,
  fDiv,
  fLoss,
  fMul,
  fRef,
  fRound,
  fSub,
  fSum,
  renderText,
} from './formula.ts';

describe('evaluate — 기본 노드', () => {
  it('const', () => {
    expect(evaluate(fConst(12.5))).toBe(12.5);
  });

  it('add / sub / mul / div (좌결합)', () => {
    expect(evaluate(fAdd(fConst(1), fConst(2), fConst(3)))).toBe(6);
    expect(evaluate(fSub(fConst(10), fConst(3), fConst(2)))).toBe(5);
    expect(evaluate(fMul(fConst(2), fConst(3), fConst(4)))).toBe(24);
    expect(evaluate(fDiv(fConst(100), fConst(4), fConst(5)))).toBe(5);
  });

  it('div — 0 나눗셈은 에러', () => {
    expect(() => evaluate(fDiv(fConst(1), fConst(0)))).toThrowError(/0으로/);
  });

  it('sum', () => {
    expect(evaluate(fSum([fConst(1.1), fConst(2.2), fConst(3.3)]))).toBeCloseTo(6.6, 12);
  });

  it('avgEndArea = (A1+A2)/2×L 손계산 대조', () => {
    // (12.5+14.2)/2 × 20 = 13.35 × 20 = 267
    expect(evaluate(fAvgEndArea(fConst(12.5), fConst(14.2), fConst(20)))).toBeCloseTo(267, 12);
  });

  it('round — 자리수 반올림', () => {
    expect(evaluate(fRound(fConst(12.3456), 3))).toBe(12.346);
    expect(evaluate(fRound(fConst(1.2345), 2))).toBe(1.23);
    expect(evaluate(fRound(fConst(151.70000000000002), 1))).toBe(151.7);
  });

  it('loss — 할증 ×(1+rate)', () => {
    expect(evaluate(fLoss(fConst(100), 0.03))).toBeCloseTo(103, 12);
  });
});

describe('evaluate — ref 참조', () => {
  const cells: Record<string, number> = { C110: 3447.0105300000005, C116: 6785.718993000002 };
  const resolver = (cell: string): number => {
    const v = cells[cell];
    if (v === undefined) throw new Error(`미정의 셀: ${cell}`);
    return v;
  };

  it('resolver 로 셀 값 해석', () => {
    expect(evaluate(fRef('C116', '흙쌓기/토사'), resolver)).toBe(6785.718993000002);
  });

  it('resolver 없이 ref 평가 → 에러', () => {
    expect(() => evaluate(fRef('C116', '흙쌓기/토사'))).toThrowError(/refResolver/);
  });
});

describe('evaluate — 중첩 체이닝 (할증+환산)', () => {
  it('면적×두께 → 할증 4% → 밀도환산 1.8', () => {
    // 100㎡ × 0.15m = 15㎥, ×1.04 = 15.6㎥, ×1.8 = 28.08TON
    const node = fMul(fLoss(fMul(fConst(100), fConst(0.15)), 0.04), fConst(1.8, '㎥→TON'));
    expect(evaluate(node)).toBeCloseTo(100 * 0.15 * 1.04 * 1.8, 12);
  });

  it('round 는 명시된 지점에서만 — 중간값은 full precision', () => {
    // 758.5×0.2 = 151.70000000000002 (부동소수) → ROUND(…, 2) = 151.7
    const raw = fMul(fConst(758.5), fConst(0.2));
    expect(evaluate(raw)).toBe(151.70000000000002);
    expect(evaluate(fRound(raw, 2))).toBe(151.7);
  });
});

describe('renderText — 사람이 읽는 산출근거', () => {
  it('양단면평균법: (12.5+14.2)/2×20', () => {
    expect(renderText(fAvgEndArea(fConst(12.5), fConst(14.2), fConst(20)))).toBe(
      '(12.5+14.2)/2×20',
    );
  });

  it('ref 는 label 로, 차감·할증 표기: 흙쌓기/토사-흙깎기/보통토사', () => {
    const net = fSub(fRef('C116', '흙쌓기/토사'), fRef('C110', '흙깎기/보통토사'));
    expect(renderText(net)).toBe('흙쌓기/토사-흙깎기/보통토사');
    expect(renderText(fLoss(fRef('C596', '되메우기 및 다짐'), 0.04))).toBe('되메우기 및 다짐×1.04');
  });

  it('우선순위 괄호: (2+3)×4, 10-(2+3), ROUND(758.5×0.2, 2)', () => {
    expect(renderText(fMul(fAdd(fConst(2), fConst(3)), fConst(4)))).toBe('(2+3)×4');
    expect(renderText(fSub(fConst(10), fAdd(fConst(2), fConst(3))))).toBe('10-(2+3)');
    expect(renderText(fRound(fMul(fConst(758.5), fConst(0.2)), 2))).toBe('ROUND(758.5×0.2, 2)');
  });

  it('할증 체인: (100+50)×1.03', () => {
    expect(renderText(fLoss(fAdd(fConst(100), fConst(50)), 0.03))).toBe('(100+50)×1.03');
  });
});
