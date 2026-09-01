/**
 * 측정 순수 로직 — 캘리브레이션 축척 적용·표시 자리수 정책·다중선택 합산.
 *
 * 정확성 핵심(FR-2, 03-DATA-MODEL §3):
 * - 연장(length): value_m = rawLen_도면단위 × scale        (길이비 → 1제곱)
 * - 면적(area):   value_m2 = rawArea_도면단위² × scale²   (길이비 → 2제곱)
 *
 * scale은 "1 도면단위 = scale m"(길이비)이므로 면적은 반드시 scale의 **제곱**을 곱한다.
 * 내부 계산은 반올림 없이 full precision을 유지하고, 반올림은 오직 표시 포맷터에서만 한다.
 * 캔버스/스토어에 의존하지 않아 단위 테스트 가능하다.
 */
import type { Measurement } from '@s-cube/schema';
import { MeasurementSchema } from '@s-cube/schema';

/** 측정 종류 — 면적/연장 (Measurement.kind 와 동일) */
export type MeasureKind = 'area' | 'length';

/** 표시 자리수 정책 — 면적 4자리, 연장 3자리 (P2-14, 표시만 반올림) */
export const AREA_DISPLAY_DIGITS = 4;
export const LENGTH_DISPLAY_DIGITS = 3;

/**
 * 도면 단위 원값에 캘리브레이션 축척을 적용해 실치수(m / ㎡)로 환산 — 순수.
 *
 * - kind='length': raw × scale
 * - kind='area':   raw × scale²  ← 면적은 축척의 제곱 (이 한 줄이 정확성의 핵심)
 *
 * 단위 변환은 이 경계에서 1회만 수행한다. rawValue는 검증·역산용으로 그대로 보존한다.
 */
export function applyScaleToRaw(
  rawValue: number,
  kind: MeasureKind,
  scale_mPerUnit: number,
): number {
  return kind === 'area' ? rawValue * scale_mPerUnit * scale_mPerUnit : rawValue * scale_mPerUnit;
}

/** kind별 표시 소수 자리수 */
export function displayDigits(kind: MeasureKind): number {
  return kind === 'area' ? AREA_DISPLAY_DIGITS : LENGTH_DISPLAY_DIGITS;
}

/** kind별 표시 단위 라벨 */
export function unitLabel(kind: MeasureKind): string {
  return kind === 'area' ? '㎡' : 'm';
}

/**
 * 측정값 표시 문자열 — 값(자리수 정책 적용) + 단위. 반올림은 여기(표시 시점)에서만.
 * 예: area 12.3456789 → "12.3457 ㎡", length 4.2 → "4.200 m"
 */
export function formatMeasureValue(value: number, kind: MeasureKind): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(displayDigits(kind))} ${unitLabel(kind)}`;
}

/**
 * 다중선택 합산 — 같은 kind 측정들의 value 합(full precision).
 * kind가 섞여 있으면(면적+연장) 합산은 의미가 없으므로 null을 반환한다(호출부에서 합계 숨김).
 * 빈 목록도 null.
 */
export function sumMeasurements(items: readonly Pick<Measurement, 'kind' | 'value'>[]): {
  kind: MeasureKind;
  total: number;
} | null {
  const first = items[0];
  if (first === undefined) return null;
  const kind = first.kind;
  let total = 0;
  for (const m of items) {
    if (m.kind !== kind) return null; // 종류 혼재 → 합산 불가
    total += m.value;
  }
  return { kind, total };
}

/**
 * 활성 도면의 측정만 필터 — measurements[]에서 drawingId === activeId 인 것만 (순수).
 * activeId가 null이면 빈 배열(도면 없음).
 */
export function measurementsForDrawing(
  measurements: readonly Measurement[],
  activeId: string | null,
): Measurement[] {
  if (activeId === null) return [];
  return measurements.filter((m) => m.drawingId === activeId);
}

/** Measurement 조립 입력 — 히트에서 뽑은 도면단위 원값 + 출처 */
export interface BuildMeasurementInput {
  id: string;
  drawingId: string;
  kind: MeasureKind;
  /** 도면 단위 원값 — area: 도면단위², length: 도면단위 */
  rawValue: number;
  method: Measurement['method'];
  sourceHandles: string[];
  holes?: string[];
  label: string;
  createdAt: string;
}

/**
 * 도면단위 원값에 축척을 적용해 Measurement 객체를 조립·검증한다 — 순수(값 주입).
 *
 * value = applyScaleToRaw(rawValue, kind, scale) — area는 scale², length는 scale.
 * id/createdAt는 호출부(부수효과 있는 곳)가 crypto.randomUUID()·now로 주입한다.
 * MeasurementSchema.parse로 즉시 검증해 잘못된 형태가 스토어에 들어가지 않게 못박는다.
 */
export function buildMeasurement(
  input: BuildMeasurementInput,
  scale_mPerUnit: number,
): Measurement {
  const value = applyScaleToRaw(input.rawValue, input.kind, scale_mPerUnit);
  return MeasurementSchema.parse({
    id: input.id,
    drawingId: input.drawingId,
    kind: input.kind,
    value,
    rawValue: input.rawValue,
    method: input.method,
    sourceHandles: input.sourceHandles,
    ...(input.holes !== undefined && input.holes.length > 0 ? { holes: input.holes } : {}),
    label: input.label,
    createdAt: input.createdAt,
  } satisfies Measurement);
}
