/**
 * 캘리브레이션 순수 로직 — scale 산출·Calibration 생성·치수 대조(P1-10, P1-12).
 * 캔버스/스토어에 의존하지 않아 단위 테스트 가능.
 */
import { type Calibration, CalibrationSchema, type NDimension, type Vec2 } from '@s-cube/schema';

/** scale = 실제 거리(m) / 도면상 거리(도면 단위) */
export function computeScale_mPerUnit(realDistance_m: number, drawingDistance: number): number {
  if (!(realDistance_m > 0) || !(drawingDistance > 0)) {
    throw new Error('거리는 0보다 커야 합니다');
  }
  return realDistance_m / drawingDistance;
}

/**
 * 2점 캘리브레이션 객체 생성 — CalibrationSchema로 즉시 검증해 반환.
 * @param nowIso 테스트 주입용 타임스탬프 (기본: 현재 시각)
 */
export function buildTwoPointCalibration(
  p1: Vec2,
  p2: Vec2,
  realDistance_m: number,
  nowIso: string = new Date().toISOString(),
): Calibration {
  const drawingDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const scale = computeScale_mPerUnit(realDistance_m, drawingDistance);
  return CalibrationSchema.parse({
    method: 'two-point',
    p1,
    p2,
    drawingDistance,
    realDistance_m,
    scale,
    calibratedAt: nowIso,
  } satisfies Calibration);
}

/**
 * 치수 텍스트에서 수치 추출. "<>"는 실측값 그대로 표시를 뜻하므로 null.
 * 예: "1200", "L=1,250.5", "1200mm" → 1200 / 1250.5 / 1200
 */
export function parseDimensionTextValue(text: string): number | null {
  const cleaned = text.replace(/<>/g, '').replace(/,/g, '');
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number.parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** 치수 대조 결과 (P1-12) */
export interface DimensionCheck {
  handle: string;
  /** 좌표 실측값 (도면 단위) */
  measuredRaw: number;
  /** 실측값 × scale (m) */
  measured_m: number;
  /** 치수 텍스트가 주장하는 값 (도면 단위 해석) */
  statedValue: number;
  /** statedValue × scale (m) */
  expected_m: number;
  /** (measured − stated) / stated × 100 */
  error_pct: number;
  /** textOverride 존재 여부 — true면 경고 배지 */
  hasOverride: boolean;
  textOverride: string | null;
}

/**
 * DIMENSION 실측값 vs 치수 텍스트 대조.
 * override가 없거나 파싱 불가면 statedValue = measuredRaw (오차 0%).
 */
export function checkDimension(dim: NDimension, scale_mPerUnit: number): DimensionCheck {
  const overrideValue =
    dim.textOverride !== null ? parseDimensionTextValue(dim.textOverride) : null;
  const statedValue = overrideValue ?? dim.measuredRaw;
  const measured_m = dim.measuredRaw * scale_mPerUnit;
  const expected_m = statedValue * scale_mPerUnit;
  const error_pct = statedValue !== 0 ? ((dim.measuredRaw - statedValue) / statedValue) * 100 : 0;
  return {
    handle: dim.handle,
    measuredRaw: dim.measuredRaw,
    measured_m,
    statedValue,
    expected_m,
    error_pct,
    hasOverride: dim.textOverride !== null,
    textOverride: dim.textOverride,
  };
}
