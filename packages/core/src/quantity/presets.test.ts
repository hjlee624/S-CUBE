import { CALC_TYPES, type CalcType, MaterialSpecSchema } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { applyLoss, contactLength, convertUnit, countTimes } from './calc.ts';
import { evaluate, fConst } from './formula.ts';
import { MATERIAL_PRESETS } from './presets.ts';

function mustFind(code: string) {
  const found = MATERIAL_PRESETS.find((p) => p.code === code);
  if (found === undefined) throw new Error(`프리셋 없음: ${code}`);
  return found;
}

describe('MATERIAL_PRESETS — 사연댐 BOQ 프리셋', () => {
  it('40개 이상', () => {
    expect(MATERIAL_PRESETS.length).toBeGreaterThanOrEqual(40);
  });

  it('Zod 전체 통과', () => {
    for (const preset of MATERIAL_PRESETS) {
      const result = MaterialSpecSchema.safeParse(preset);
      expect(result.success, `${preset.code}: ${result.success ? '' : result.error.message}`).toBe(
        true,
      );
    }
  });

  it('code 중복 없음', () => {
    const codes = MATERIAL_PRESETS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('calcType 분포 — 8종 유형 전부 존재', () => {
    const byType = new Map<CalcType, number>();
    for (const p of MATERIAL_PRESETS) {
      byType.set(p.calcType, (byType.get(p.calcType) ?? 0) + 1);
    }
    for (const t of CALC_TYPES) {
      expect(byType.get(t) ?? 0, `calcType '${t}' 프리셋 없음`).toBeGreaterThan(0);
    }
    // BOQ 최대 물량군은 단면×연장
    expect(byType.get('section-length') ?? 0).toBeGreaterThanOrEqual(8);
  });

  it('필수 공종 포함 — 흙깎기 3종·거푸집 높이구간·동바리 공㎥·철근 D13~D29', () => {
    expect(
      MATERIAL_PRESETS.filter(
        (p) => p.name.startsWith('흙깎기/') && p.calcType === 'section-length',
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(mustFind('FORM-EURO-C-0710').spec).toContain('7m초과~10m이하');
    expect(mustFind('SHORE-SYSTEM').unit).toBe('공㎥');
    for (const d of ['D13', 'D16', 'D19', 'D22', 'D25', 'D29']) {
      expect(mustFind(`REBAR-${d}`).spec).toContain(d);
    }
  });

  it('철근 단위중량 (BOQ r867~r872: 0.995~5.040kg/m)', () => {
    const kgPerM: Record<string, number> = {
      'REBAR-D13': 0.995,
      'REBAR-D16': 1.56,
      'REBAR-D19': 2.25,
      'REBAR-D22': 3.04,
      'REBAR-D25': 3.98,
      'REBAR-D29': 5.04,
    };
    for (const [code, expected] of Object.entries(kgPerM)) {
      const conv = mustFind(code).conversions?.find((c) => c.toUnit === 'kg');
      expect(conv?.factor, code).toBe(expected);
    }
  });

  it('할증 — 철근 3%, 쇄석자갈 4%', () => {
    expect(mustFind('REBAR-SUPPLY').lossRate).toBe(0.03);
    expect(mustFind('MAT-CRUSHED-GRAVEL').lossRate).toBe(0.04);
  });

  it('정척 — 파형강관 6m (m → 본)', () => {
    expect(mustFind('PIPE-CORR-D600').standardLength_m).toBe(6);
  });

  it('두께 규격연동 (RW-6) — area-thickness 프리셋에 thickness_m 존재', () => {
    // area-thickness 는 두께를 규격에서 읽는다 → thickness_m 이 반드시 있어야 함(하드코딩 폐지).
    for (const p of MATERIAL_PRESETS) {
      if (p.calcType === 'area-thickness') {
        expect(p.thickness_m, `${p.code}: area-thickness 인데 thickness_m 누락`).toBeGreaterThan(0);
      }
    }
    // 대표 두께 값 확인 — 쇄석포설 0.15, 콘크리트 표층 0.2, 표토제거 0.2.
    expect(mustFind('EARTH-CRUSHED-SPREAD').thickness_m).toBe(0.15);
    expect(mustFind('PAVE-CONC-SURFACE').thickness_m).toBe(0.2);
    expect(mustFind('EARTH-STRIP-TOPSOIL').thickness_m).toBe(0.2);
  });
});

describe('프리셋 계산 시나리오', () => {
  it('거푸집(유로폼) ㎡ — 접촉폭 2.4m × 벽체 연장 130.3m', () => {
    const preset = mustFind('FORM-EURO-N-0007');
    expect(preset.calcType).toBe('contact-length');
    expect(preset.unit).toBe('㎡');
    expect(evaluate(contactLength(2.4, 130.3))).toBeCloseTo(312.72, 9); // BOQ r187 접근수로 유로폼 보통 0~7m
  });

  it('철근 D13 TON 환산 — 연장 1000m → 0.995TON, 구입·운반 = ×1.03', () => {
    const preset = mustFind('REBAR-D13');
    const tonConv = preset.conversions?.find((c) => c.toUnit === 'TON');
    expect(tonConv).toBeDefined();
    if (tonConv === undefined) return;
    const assembled = convertUnit(fConst(1000, 'D13 연장(m)'), tonConv.factor, tonConv.note ?? '');
    expect(evaluate(assembled)).toBeCloseTo(0.995, 12);
    const supply = mustFind('REBAR-SUPPLY');
    expect(evaluate(applyLoss(assembled, supply.lossRate ?? 0))).toBeCloseTo(0.995 * 1.03, 12);
  });

  it('ROCK ANCHOR — 52공 × L=5.5m = 286m 천공연장', () => {
    const preset = mustFind('ANCHOR-ROCK-L55');
    const mConv = preset.conversions?.find((c) => c.toUnit === 'm');
    expect(mConv?.factor).toBe(5.5);
    expect(evaluate(countTimes(52, mConv?.factor))).toBeCloseTo(286, 12); // BOQ r267 조절부 52공
  });
});
