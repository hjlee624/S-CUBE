import { describe, expect, it } from 'vitest';
import {
  applyLoss,
  areaThickness,
  contactLength,
  convertUnit,
  countTimes,
  sectionLength,
} from './calc.ts';
import { evaluate, fRef, fSub, renderText } from './formula.ts';
import { averageEndArea } from './volume.ts';

describe('sectionLength — 단면×연장', () => {
  it('기존 averageEndArea 와 일치', () => {
    const cases: [number, number, number][] = [
      [10, 20, 20],
      [12.5, 14.2, 20],
      [1.111, 2.222, 3.3],
      [15.5, 42.1, 0], // 전/후 불연속 → 체적 0
    ];
    for (const [a1, a2, l] of cases) {
      expect(evaluate(sectionLength(a1, a2, l))).toBe(averageEndArea(a1, a2, l));
    }
  });
});

describe('areaThickness — 면적×두께', () => {
  it('손계산 대조: 34.5㎡ × 0.15m', () => {
    expect(evaluate(areaThickness(34.5, 0.15))).toBeCloseTo(5.175, 12);
  });
});

describe('contactLength — 접촉폭×연장 (거푸집·비계 파생)', () => {
  it('손계산 대조: 접촉폭 2.4m × 연장 20m = 48㎡', () => {
    expect(evaluate(contactLength(2.4, 20))).toBe(48);
  });
});

describe('countTimes — 개수(×단위계수)', () => {
  it('개수만', () => {
    expect(evaluate(countTimes(52))).toBe(52);
  });

  it('개수 × 단위계수 (수평배수공 322공 × L=10m)', () => {
    expect(evaluate(countTimes(322, 10))).toBe(3220);
  });
});

describe('applyLoss / convertUnit — 체이닝', () => {
  it('철근 D13: 연장 1000m × 0.000995(TON/m) → 구입·운반 할증 3%', () => {
    const assembled = convertUnit(countTimes(1000), 0.000995, 'D13 0.995kg/m → TON');
    expect(evaluate(assembled)).toBeCloseTo(0.995, 12);
    expect(evaluate(applyLoss(assembled, 0.03))).toBeCloseTo(0.995 * 1.03, 12);
  });
});

describe('BOQ 실수식 재현 (사연댐 tmp-boq-dump)', () => {
  const cells: Record<string, number> = {
    C110: 3447.0105300000005, // 흙깎기/보통토사
    C116: 6785.718993000002, // 흙쌓기/토사
    C596: 442.66908000000006, // 되메우기 및 다짐
  };
  const resolver = (cell: string): number => {
    const v = cells[cell];
    if (v === undefined) throw new Error(`미정의 셀: ${cell}`);
    return v;
  };

  it('순성토운반 = 흙쌓기 − 흙깎기 (r119: =C116-C110 → 3338.708463…)', () => {
    const net = fSub(fRef('C116', '흙쌓기/토사'), fRef('C110', '흙깎기/보통토사'));
    expect(evaluate(net, resolver)).toBe(6785.718993000002 - 3447.0105300000005);
    expect(evaluate(net, resolver)).toBeCloseTo(3338.7084630000018, 9);
    expect(renderText(net)).toBe('흙쌓기/토사-흙깎기/보통토사');
  });

  it('쇄석자갈 = 되메우기 × 1.04 (r597: =C596*1.04 → 460.3758432…)', () => {
    const gravel = applyLoss(fRef('C596', '되메우기 및 다짐'), 0.04);
    expect(evaluate(gravel, resolver)).toBeCloseTo(460.3758432000001, 9);
  });

  it('콘크리트 표층 = 758.5㎡ × 0.2m (r144: =758.5*0.2 → 151.70000000000002)', () => {
    expect(evaluate(areaThickness(758.5, 0.2))).toBe(151.70000000000002);
  });
});
