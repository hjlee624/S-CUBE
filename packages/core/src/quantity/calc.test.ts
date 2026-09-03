import { CALC_TYPES, type CalcType } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  applyLoss,
  areaThickness,
  CALC_BUILDERS,
  CALC_TYPE_OF,
  contactLength,
  convertUnit,
  countTimes,
  derivedContact,
  derivedScaffold,
  derivedShore,
  sectionLength,
} from './calc.ts';
import { evaluate, fConst, fRef, fSub, renderText } from './formula.ts';
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

describe('CALC_TYPE_OF — 빌더↔CalcType 매핑 정합 (RW-7, taxonomy 대조)', () => {
  it('4개 기하 빌더가 taxonomy 8유형 중 대응 유형에 1:1 매핑된다', () => {
    // docs/quantity-calc-taxonomy.md §계산 유형 8종 — 빌더 대응 열과 동일해야 한다.
    expect(CALC_TYPE_OF).toEqual({
      sectionLength: 'section-length',
      areaThickness: 'area-thickness',
      contactLength: 'contact-length',
      countTimes: 'count',
    });
  });

  it('CALC_BUILDERS 는 CALC_TYPE_OF 의 키 집합과 정확히 일치', () => {
    expect([...CALC_BUILDERS].sort()).toEqual(Object.keys(CALC_TYPE_OF).sort());
  });

  it('매핑된 CalcType 은 전부 schema CALC_TYPES 의 유효 유형', () => {
    for (const t of Object.values(CALC_TYPE_OF)) {
      expect(CALC_TYPES).toContain(t);
    }
  });

  it('빌더 없는 4유형(area·length·ref·manual)은 매핑에서 제외 — 커버리지 고정', () => {
    const mapped = new Set<CalcType>(Object.values(CALC_TYPE_OF));
    const unmapped = CALC_TYPES.filter((t) => !mapped.has(t));
    expect([...unmapped].sort()).toEqual(['area', 'length', 'manual', 'ref']);
  });
});

describe('파생 빌더 (RW-5) — 둘레×L, 둘레×H, 면적×H 손계산', () => {
  it('derivedContact(거푸집) = 둘레 × 연장', () => {
    // 둘레 8.4m(fRef 자리에 손계산 상수 대입) × 연장 20m = 168㎡.
    const node = derivedContact(fConst(8.4, '둘레(m)'), 20);
    expect(evaluate(node)).toBeCloseTo(168, 9);
    expect(renderText(node)).toBe('둘레(m)×20');
  });

  it('derivedScaffold(비계) = 외곽 둘레 × 높이', () => {
    // 외곽 둘레 12m × 높이 3.5m = 42㎡.
    const node = derivedScaffold(fConst(12, '외곽둘레(m)'), 3.5);
    expect(evaluate(node)).toBeCloseTo(42, 9);
  });

  it('derivedShore(동바리) = 바닥 면적 × 높이 (공㎥)', () => {
    // 바닥 수평 면적 30㎡ × 높이 4m = 120 공㎥.
    const node = derivedShore(fConst(30, '바닥면적(㎡)'), 4);
    expect(evaluate(node)).toBeCloseTo(120, 9);
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
