/**
 * 산출 항목 파생·재계산 테스트 (Phase 4-B, P4-10).
 *
 * 커버: reassembleItem(측정·구간·참조), recomputeItems 의존 그래프(참조는 대상 확정 후),
 * blocked 전파, toTakeoffItem 좁히기, restoreEditableItems 복원.
 */
import type { MaterialSpec, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  type EditableTakeoffItem,
  reassembleItem,
  recomputeItems,
  restoreEditableItems,
  type TakeoffDraft,
  toTakeoffItem,
} from './takeoff-derive.ts';

function draft(id: string, source: TakeoffDraft['source'], name = id): TakeoffDraft {
  return {
    id,
    workType: '토공사',
    name,
    specCode: '',
    unit: '㎥',
    source,
    sourceRefs: [],
  };
}

function section(id: string, chainage_m: number, area_m2: number): StationSection {
  return {
    id,
    station: {
      raw: `No.${chainage_m}`,
      no: 0,
      plus_m: chainage_m,
      chainage_m,
      discontinuity: null,
    },
    itemKey: '절토',
    area_m2,
  };
}

describe('reassembleItem', () => {
  it('측정 소스 → quantity 확정', () => {
    const it = reassembleItem(
      draft('i1', { kind: 'measurement', measurementId: 'm', value: 30, label: 'x' }),
      undefined,
      [],
      [],
    );
    expect(it.quantity).toBe(30);
    expect(it.blocked).toBe(false);
    expect(it.basis).not.toBeNull();
  });

  it('구간 체적 소스 → 양단면평균법 합', () => {
    const sections = [section('a', 0, 10), section('b', 20, 14)];
    const it = reassembleItem(
      draft('i1', { kind: 'segment-volume', itemKey: '절토' }),
      undefined,
      sections,
      [],
    );
    expect(it.quantity).toBeCloseTo(240, 10);
    expect(it.blocked).toBe(false);
  });

  it('blocked 구간 소스 → blocked=true, quantity=NaN, basis=null', () => {
    // (전) 결측: NaN area → core blocked.
    const pre: StationSection = {
      id: 'pre',
      station: { raw: 'No.8(전)', no: 8, plus_m: 0, chainage_m: 160, discontinuity: 'pre' },
      itemKey: '절토',
      area_m2: Number.NaN,
    };
    const post: StationSection = {
      id: 'post',
      station: { raw: 'No.8(후)', no: 8, plus_m: 0, chainage_m: 160, discontinuity: 'post' },
      itemKey: '절토',
      area_m2: 12,
    };
    const it = reassembleItem(
      draft('i1', { kind: 'segment-volume', itemKey: '절토' }),
      undefined,
      [section('before', 140, 10), pre, post],
      [],
    );
    expect(it.blocked).toBe(true);
    expect(it.basis).toBeNull();
    expect(Number.isNaN(it.quantity)).toBe(true);
  });
});

describe('recomputeItems — 의존 그래프 (P4-10)', () => {
  it('참조 항목은 대상 수량 확정 후 평가된다', () => {
    // i1: 측정 100. i2: i1 참조 × 계수 2 → 200.
    const i1 = reassembleItem(
      draft('i1', { kind: 'measurement', measurementId: 'm', value: 100, label: '콘크리트' }),
      undefined,
      [],
      [],
    );
    const i2: EditableTakeoffItem = {
      ...draft('i2', {
        kind: 'ref',
        refItemIds: ['i1'],
        refs: [{ itemId: 'i1', label: '콘크리트', quantity: 0 }],
        factor: 2,
        factorLabel: '접촉폭계수',
      }),
      basis: null,
      quantity: Number.NaN,
      blocked: false,
    };

    const recomputed = recomputeItems([i1, i2], [], []);
    expect(recomputed[0]?.quantity).toBe(100);
    expect(recomputed[1]?.quantity).toBe(200);
  });

  it('원본 측정 변경 시 참조 항목도 갱신된다', () => {
    // i1 을 300 으로 갱신하면 i2(=i1×2)도 600.
    const i1: EditableTakeoffItem = {
      ...draft('i1', { kind: 'measurement', measurementId: 'm', value: 300, label: 'c' }),
      basis: null,
      quantity: Number.NaN,
      blocked: false,
    };
    const i2: EditableTakeoffItem = {
      ...draft('i2', {
        kind: 'ref',
        refItemIds: ['i1'],
        refs: [{ itemId: 'i1', label: 'c', quantity: 0 }],
        factor: 2,
      }),
      basis: null,
      quantity: Number.NaN,
      blocked: false,
    };
    const recomputed = recomputeItems([i1, i2], [], []);
    expect(recomputed[0]?.quantity).toBe(300);
    expect(recomputed[1]?.quantity).toBe(600);
  });
});

describe('파생 소스 (RW-5) — 재조립·재계산', () => {
  /** 한 변 5 정사각형 (닫힘) — 둘레 20, 면적 25 (scale=1) */
  const square = [
    { p: { x: 0, y: 0 }, bulge: 0 },
    { p: { x: 5, y: 0 }, bulge: 0 },
    { p: { x: 5, y: 5 }, bulge: 0 },
    { p: { x: 0, y: 5 }, bulge: 0 },
  ];

  function concreteBase(id: string, name: string): EditableTakeoffItem {
    return reassembleItem(
      { ...draft(id, { kind: 'manual', value: 30 }, name), specCode: '', unit: '㎥' },
      undefined,
      [],
      [],
    );
  }

  it('derived-contact 항목 quantity = 둘레×연장, calcType=contact-length', () => {
    const base = concreteBase('conc', '옹벽 콘크리트');
    const form = reassembleItem(
      {
        ...draft('form', {
          kind: 'derived-contact',
          baseItemId: 'conc',
          baseLabel: '옹벽 콘크리트',
          basePolyline: square,
          baseClosed: true,
          scale_mPerUnit: 1,
          length_m: 12,
        }),
        unit: '㎡',
        name: '거푸집',
      },
      undefined,
      [],
      [base],
    );
    // 둘레 20 × 연장 12 = 240㎡.
    expect(form.quantity).toBeCloseTo(240, 9);
    expect(form.blocked).toBe(false);
    expect(form.calcType).toBe('contact-length');
    expect(form.basis).not.toBeNull();
  });

  it('recomputeItems — 기준 항목명 변경이 파생 baseLabel 로 전파된다', () => {
    const base: EditableTakeoffItem = concreteBase('conc', '옹벽 콘크리트');
    const shore: EditableTakeoffItem = reassembleItem(
      {
        ...draft('shore', {
          kind: 'derived-shore',
          baseItemId: 'conc',
          baseLabel: '옛이름',
          basePolyline: square,
          baseClosed: true,
          scale_mPerUnit: 1,
          height_m: 4,
        }),
        unit: '공㎥',
        name: '동바리',
      },
      undefined,
      [],
      [base],
    );
    // 면적 25 × 높이 4 = 100 공㎥.
    expect(shore.quantity).toBeCloseTo(100, 9);

    const recomputed = recomputeItems([{ ...base, name: '새 옹벽' }, shore], [], []);
    const derived = recomputed.find((it) => it.id === 'shore');
    expect(derived?.source.kind).toBe('derived-shore');
    if (derived?.source.kind === 'derived-shore') {
      expect(derived.source.baseLabel).toBe('새 옹벽'); // 최신 기준 항목명 반영
    }
    expect(derived?.quantity).toBeCloseTo(100, 9); // 기하 캐시 유지 → 값 불변
  });

  it('입력 없는 파생은 blocked (산출 차단)', () => {
    const base = concreteBase('conc', '옹벽');
    const noInput = reassembleItem(
      {
        ...draft('scaf', {
          kind: 'derived-scaffold',
          baseItemId: 'conc',
          baseLabel: '옹벽',
          basePolyline: square,
          baseClosed: true,
          scale_mPerUnit: 1,
          // height_m 없음.
        }),
        unit: '㎡',
        name: '비계',
      },
      undefined,
      [],
      [base],
    );
    expect(noInput.blocked).toBe(true);
    expect(noInput.basis).toBeNull();
    expect(Number.isNaN(noInput.quantity)).toBe(true);
  });
});

describe('toTakeoffItem / restoreEditableItems 왕복', () => {
  it('정상 항목은 schema TakeoffItem 로 좁혀지고 복원된다', () => {
    const specs: MaterialSpec[] = [
      {
        code: 'C1',
        workType: '구조물공',
        name: '콘크리트',
        spec: '25-24-15',
        unit: '㎥',
        calcType: 'section-length',
      },
    ];
    const it = reassembleItem(
      { ...draft('i1', { kind: 'manual', value: 42 }), specCode: 'C1', name: '콘크리트' },
      specs[0],
      [],
      [],
    );
    const narrowed = toTakeoffItem(it);
    expect(narrowed).not.toBeNull();
    if (narrowed === null) return;
    expect(narrowed.quantity).toBe(42);

    const restored = restoreEditableItems([narrowed], specs);
    expect(restored[0]?.quantity).toBe(42);
    expect(restored[0]?.name).toBe('콘크리트');
    expect(restored[0]?.source.kind).toBe('manual');
  });

  it('blocked 항목은 toTakeoffItem 이 null (저장 제외)', () => {
    const blocked: EditableTakeoffItem = {
      ...draft('i1', { kind: 'segment-volume', itemKey: '절토' }),
      basis: null,
      quantity: Number.NaN,
      blocked: true,
    };
    expect(toTakeoffItem(blocked)).toBeNull();
  });
});
