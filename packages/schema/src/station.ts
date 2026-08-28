import { z } from 'zod';

/**
 * 측점 (03-DATA-MODEL §4) — "No.8+0.000(전)" 파싱 결과.
 * chainage_m = no × stationInterval + plus_m.
 * discontinuity: 동일 chainage 에 (전)/(후) 두 단면이 있는 불연속 지점 표시.
 */
export const StationSchema = z.object({
  /** 원본 표기 (예: 'No.8+0.000(전)') */
  raw: z.string().min(1),
  no: z.number().int().nonnegative(),
  plus_m: z.number(),
  chainage_m: z.number(),
  discontinuity: z.union([z.literal('pre'), z.literal('post')]).nullable(),
});

export type Station = z.infer<typeof StationSchema>;

/** 측점별 단면 (03-DATA-MODEL §4) — 항목(절토·성토 등)별 단면적 */
export const StationSectionSchema = z.object({
  id: z.string().min(1),
  station: StationSchema,
  /** '절토', '성토', '표토제거' 등 */
  itemKey: z.string().min(1),
  area_m2: z.number().nonnegative(),
  /** 도면 측정 출처 (수동 입력이면 undefined) */
  measurementId: z.string().optional(),
  note: z.string().optional(),
});

export type StationSection = z.infer<typeof StationSectionSchema>;

/**
 * 측점 구간 (03-DATA-MODEL §4) — volume_m3 = (a1+a2)/2 × length_m.
 * 전/후 불연속 구간은 length_m = 0 → 체적 0.
 */
export const SegmentSchema = z.object({
  from: StationSchema,
  to: StationSchema,
  /** to.chainage - from.chainage */
  length_m: z.number().nonnegative(),
  itemKey: z.string().min(1),
  /** 시점 단면적 (㎡) */
  a1: z.number().nonnegative(),
  /** 종점 단면적 (㎡) */
  a2: z.number().nonnegative(),
  volume_m3: z.number(),
  method: z.union([z.literal('average-end-area'), z.literal('prismoidal')]),
});

export type Segment = z.infer<typeof SegmentSchema>;
