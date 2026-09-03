import { describe, expect, it } from 'vitest';
import {
  CALC_TYPES,
  CalcTypeSchema,
  FormulaNodeSchema,
  MaterialSpecSchema,
  TakeoffItemSchema,
} from './quantity.ts';
import { SegmentSchema, StationSchema, StationSectionSchema } from './station.ts';

describe('CalcTypeSchema', () => {
  it('8종 유형 전부 통과', () => {
    expect(CALC_TYPES).toHaveLength(8);
    for (const t of CALC_TYPES) {
      expect(CalcTypeSchema.parse(t)).toBe(t);
    }
  });

  it('미정의 유형 거부', () => {
    expect(CalcTypeSchema.safeParse('volume').success).toBe(false);
  });
});

describe('FormulaNodeSchema', () => {
  it('중첩 트리 통과 — loss(avgEndArea)', () => {
    const node = {
      op: 'loss',
      rate: 0.03,
      arg: {
        op: 'avgEndArea',
        a1: { op: 'const', value: 12.5, label: 'A1(㎡)' },
        a2: { op: 'const', value: 14.2 },
        length: { op: 'ref', cell: '상세!E12', label: 'L(m)' },
      },
    };
    expect(FormulaNodeSchema.parse(node)).toEqual(node);
  });

  it('sub/mul args 배열 통과', () => {
    const node = {
      op: 'sub',
      args: [
        { op: 'ref', cell: 'C116', label: '흙쌓기/토사' },
        { op: 'ref', cell: 'C110', label: '흙깎기/보통토사' },
      ],
    };
    expect(FormulaNodeSchema.parse(node)).toEqual(node);
  });

  it('빈 args·잘못된 op 거부', () => {
    expect(FormulaNodeSchema.safeParse({ op: 'add', args: [] }).success).toBe(false);
    expect(FormulaNodeSchema.safeParse({ op: 'pow', args: [] }).success).toBe(false);
    expect(
      FormulaNodeSchema.safeParse({ op: 'round', arg: { op: 'const', value: 1 }, digits: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe('MaterialSpecSchema', () => {
  it('철근 규격 (환산+할증) 통과', () => {
    const spec = {
      code: 'REBAR-D13',
      workType: '사급자재',
      name: '하이바(고장력철근)',
      spec: 'D13M/M 0.995KG/M SD35,40',
      unit: 'TON',
      calcType: 'length',
      conversions: [{ toUnit: 'kg', factor: 0.995, note: '단위중량' }],
      lossRate: 0.03,
    };
    expect(MaterialSpecSchema.parse(spec).calcType).toBe('length');
  });

  it('calcType 누락 거부', () => {
    const result = MaterialSpecSchema.safeParse({
      code: 'X',
      workType: '토공사',
      name: '흙깎기',
      spec: '',
      unit: '㎥',
    });
    expect(result.success).toBe(false);
  });

  it('thickness_m (RW-6) — 양수 통과·0/음수 거부', () => {
    const base = {
      code: 'AT',
      workType: '토공사',
      name: '쇄석포설',
      spec: 't=150mm',
      unit: '㎥',
      calcType: 'area-thickness',
    };
    expect(MaterialSpecSchema.parse({ ...base, thickness_m: 0.15 }).thickness_m).toBe(0.15);
    expect(MaterialSpecSchema.safeParse({ ...base, thickness_m: 0 }).success).toBe(false);
    expect(MaterialSpecSchema.safeParse({ ...base, thickness_m: -0.1 }).success).toBe(false);
    // 옵션 — 없어도 스키마는 통과(차단은 산출 계층 책임).
    expect(MaterialSpecSchema.safeParse(base).success).toBe(true);
  });
});

describe('TakeoffItemSchema', () => {
  it('basis(FormulaNode) 포함 통과', () => {
    const item = {
      id: 'ti-1',
      workType: '토공사',
      specCode: 'EARTH-CUT-SOIL',
      unit: '㎥',
      quantity: 300,
      basis: {
        op: 'avgEndArea',
        a1: { op: 'const', value: 10 },
        a2: { op: 'const', value: 20 },
        length: { op: 'const', value: 20 },
      },
      sourceRefs: [{ drawingId: 'dwg-1', handles: ['1A2B'] }],
    };
    expect(TakeoffItemSchema.parse(item)).toEqual(item);
  });

  it('calcType (RW-7) — 옵션 필드 통과·유효 유형만 허용', () => {
    const item = {
      id: 'ti-2',
      workType: '현장타설 콘크리트 공사',
      specCode: 'CONC-REINF-PUMP',
      unit: '㎥',
      calcType: 'section-length',
      quantity: 300,
      basis: { op: 'const', value: 300 },
      sourceRefs: [],
    };
    expect(TakeoffItemSchema.parse(item).calcType).toBe('section-length');
    // 잘못된 calcType 거부.
    expect(TakeoffItemSchema.safeParse({ ...item, calcType: 'volume' }).success).toBe(false);
    // 옵션 — 없어도 통과(기존 항목 호환).
    const { calcType: _omit, ...noCalc } = item;
    expect(TakeoffItemSchema.safeParse(noCalc).success).toBe(true);
  });
});

describe('Station/StationSection/Segment', () => {
  const station = {
    raw: 'No.8+0.000(전)',
    no: 8,
    plus_m: 0,
    chainage_m: 160,
    discontinuity: 'pre',
  };

  it('측점 (전) 표기 통과', () => {
    expect(StationSchema.parse(station).discontinuity).toBe('pre');
  });

  it('불연속 없는 측점은 null', () => {
    expect(
      StationSchema.parse({ ...station, raw: 'No.8+0.000', discontinuity: null }).discontinuity,
    ).toBeNull();
  });

  it('StationSection·Segment 통과 (연장 0 불연속 구간 포함)', () => {
    expect(
      StationSectionSchema.safeParse({
        id: 'ss-1',
        station,
        itemKey: '절토',
        area_m2: 12.5,
      }).success,
    ).toBe(true);
    expect(
      SegmentSchema.safeParse({
        fromId: 'ss-1',
        toId: 'ss-2',
        from: station,
        to: { ...station, raw: 'No.8+0.000(후)', discontinuity: 'post' },
        length_m: 0,
        itemKey: '절토',
        a1: 12.5,
        a2: 14.2,
        volume_m3: 0,
        method: 'average-end-area',
      }).success,
    ).toBe(true);
  });
});
