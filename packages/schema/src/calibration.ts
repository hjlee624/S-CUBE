import { z } from 'zod';

const Vec2Schema = z.object({ x: z.number(), y: z.number() });

/**
 * 축척 캘리브레이션 — 없으면 면적/연장 산출 차단 (FR-2.3).
 * scale = realDistance_m / drawingDistance
 */
export const CalibrationSchema = z.object({
  method: z.union([z.literal('two-point'), z.literal('header-units')]),
  p1: Vec2Schema,
  p2: Vec2Schema,
  /** 두 점 사이 도면상 거리 (도면 단위) */
  drawingDistance: z.number().positive(),
  /** 사용자가 입력한 실제 거리 (m) */
  realDistance_m: z.number().positive(),
  /** 도면 단위 → m 환산 계수 */
  scale: z.number().positive(),
  verifiedBy: z
    .array(
      z.object({
        handle: z.string(),
        expected_m: z.number(),
        error_pct: z.number(),
      }),
    )
    .optional(),
  calibratedAt: z.string(),
});

export type Calibration = z.infer<typeof CalibrationSchema>;
