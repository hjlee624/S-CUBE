import { z } from 'zod';

/**
 * 수량 계산 유형 8종 — docs/quantity-calc-taxonomy.md 분류.
 *
 * - section-length: 단면적 × 연장 (양단면평균법) → ㎥
 * - area-thickness: 면적 × 두께 → ㎥
 * - area:           폐합영역 면적 직접 → ㎡
 * - contact-length: 접촉폭(둘레) × 연장 → ㎡ (거푸집·비계·동바리 파생)
 * - length:         선형 연장 직접 → m
 * - count:          개수 집계 → EA·개소·본·공·주
 * - ref:            다른 항목 참조 파생 (합·차·계수)
 * - manual:         수동 입력 (식·hr·mth·회)
 */
export const CALC_TYPES = [
  'section-length',
  'area-thickness',
  'area',
  'contact-length',
  'length',
  'count',
  'ref',
  'manual',
] as const;

export type CalcType = (typeof CALC_TYPES)[number];

export const CalcTypeSchema = z.enum(CALC_TYPES);

/**
 * 산출근거 트리 (03-DATA-MODEL §6) — 엑셀 수식으로 렌더 가능해야 한다.
 * 면적×두께 같은 의미는 별도 노드가 아니라 mul + label 로 표현한다.
 */
export type FormulaNode =
  | { op: 'const'; value: number; label?: string }
  | { op: 'ref'; cell: string; label: string } // 다른 시트 셀 참조
  | { op: 'add' | 'sub' | 'mul' | 'div'; args: FormulaNode[] }
  | { op: 'avgEndArea'; a1: FormulaNode; a2: FormulaNode; length: FormulaNode }
  | { op: 'sum'; args: FormulaNode[] }
  | { op: 'round'; arg: FormulaNode; digits: number }
  | { op: 'loss'; arg: FormulaNode; rate: number };

export const FormulaNodeSchema: z.ZodType<FormulaNode> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('const'), value: z.number(), label: z.string().optional() }),
    z.object({ op: z.literal('ref'), cell: z.string().min(1), label: z.string() }),
    z.object({
      op: z.union([z.literal('add'), z.literal('sub'), z.literal('mul'), z.literal('div')]),
      args: z.array(FormulaNodeSchema).min(1),
    }),
    z.object({
      op: z.literal('avgEndArea'),
      a1: FormulaNodeSchema,
      a2: FormulaNodeSchema,
      length: FormulaNodeSchema,
    }),
    z.object({ op: z.literal('sum'), args: z.array(FormulaNodeSchema).min(1) }),
    z.object({ op: z.literal('round'), arg: FormulaNodeSchema, digits: z.number().int() }),
    z.object({ op: z.literal('loss'), arg: FormulaNodeSchema, rate: z.number() }),
  ]),
);

/**
 * 규격 마스터 (03-DATA-MODEL §5) + calcType.
 * conversions 는 산출 기본 단위 → 발주 단위 환산 (예: 철근 m → TON, 단위중량 kg/m).
 * lossRate 는 할증률 (0.03 = 3%).
 */
export const MaterialSpecSchema = z.object({
  code: z.string().min(1),
  /** 공종 (예: '토공사', '현장타설 콘크리트 공사') */
  workType: z.string().min(1),
  name: z.string().min(1),
  spec: z.string(),
  /** 발주 단위 (㎥·㎡·m·TON·EA·공㎥ …) */
  unit: z.string().min(1),
  /** 수량 계산 유형 — 도면 취득 방식 결정 */
  calcType: CalcTypeSchema,
  conversions: z
    .array(
      z.object({
        toUnit: z.string().min(1),
        factor: z.number().positive(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  /** 할증률 (0.03 = 3%) */
  lossRate: z.number().min(0).optional(),
  /** 정척 길이 (m → 본 환산) */
  standardLength_m: z.number().positive().optional(),
});

export type MaterialSpec = z.infer<typeof MaterialSpecSchema>;

/** 산출 항목 (03-DATA-MODEL §6) — basis 가 산출근거 트리 */
export const TakeoffItemSchema = z.object({
  id: z.string().min(1),
  /** 공종 */
  workType: z.string().min(1),
  /** MaterialSpec.code */
  specCode: z.string().min(1),
  unit: z.string().min(1),
  /** 계산 결과 (캐시) — 내부 계산은 반올림하지 않는다 */
  quantity: z.number(),
  /** 산출근거 트리 */
  basis: FormulaNodeSchema,
  sourceRefs: z.array(
    z.object({
      drawingId: z.string().min(1),
      handles: z.array(z.string()),
    }),
  ),
});

export type TakeoffItem = z.infer<typeof TakeoffItemSchema>;
