import { z } from 'zod';

/**
 * 측정 결과 (03-DATA-MODEL §3) — 도면에서 취득한 면적/연장 한 건.
 *
 * - value: 캘리브레이션 적용 후 값. area → ㎡, length → m.
 * - rawValue: 도면 단위 원값(검증·역산용). 면적은 도면단위², 연장은 도면단위.
 *   (단위 변환은 web 경계에서 1회만 — core 기하는 도면 단위 순수값만 다룬다.)
 * - sourceHandles: 측정 근거가 된 엔티티 handle 목록(역추적 키).
 * - holes: 차감된 내부 영역(island)의 handle 목록.
 * - method: 측정 취득 방식.
 *   - polyline:         폐합 폴리라인 면적/길이
 *   - hatch:            HATCH 경계 루프 면적
 *   - auto-boundary:    자동 폐합 경계 탐지 (Phase 5)
 *   - entity-chain:     선분·원호 연결 체인
 *   - profile-cut-fill: 원지반선·계획선 2클릭 자동 절토/성토 단면적 (FR-3.10)
 *   - dimension:        DIMENSION 실측값
 *   - manual:           수동 입력
 * - cutFill: method='profile-cut-fill'일 때 절토(cut)/성토(fill) 부호 구분(FR-3.10).
 */
export const MeasurementSchema = z.object({
  id: z.string().min(1),
  drawingId: z.string().min(1),
  kind: z.union([z.literal('area'), z.literal('length')]),
  /** 캘리브레이션 적용 후 값 — area: ㎡, length: m */
  value: z.number(),
  /** 도면 단위 원값 (검증용) — 면적: 도면단위², 연장: 도면단위 */
  rawValue: z.number(),
  method: z.union([
    z.literal('polyline'),
    z.literal('hatch'),
    z.literal('auto-boundary'),
    z.literal('entity-chain'),
    z.literal('profile-cut-fill'),
    z.literal('dimension'),
    z.literal('manual'),
  ]),
  /** method='profile-cut-fill'일 때 절토(cut)/성토(fill) 부호 구분 (FR-3.10) */
  cutFill: z.union([z.literal('cut'), z.literal('fill')]).optional(),
  /** 측정 근거 엔티티 handle (역추적 키) */
  sourceHandles: z.array(z.string()),
  /** 차감된 내부 영역(island)의 handle */
  holes: z.array(z.string()).optional(),
  /** 사용자 명명 ("절토부", "옹벽 본체" 등) */
  label: z.string(),
  /** 생성 시각 (ISO8601) */
  createdAt: z.string(),
});

export type Measurement = z.infer<typeof MeasurementSchema>;
