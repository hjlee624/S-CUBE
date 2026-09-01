import type { Segment, StationSection } from '@s-cube/schema';
import { sortSections } from './sort.ts';

/**
 * 이상 감지 (P3-15) — 측점 단면·구간에서 의심 값을 배지로 표시할 수 있게 검출한다.
 *
 * 검출 대상:
 *   - 인접 단면적 3배 이상 급변 (area-jump)
 *   - 연장이 표준 측점 간격과 크게 다름 (length-off-interval)
 *   - 단면적 0 또는 음수 (area-nonpositive)
 *
 * 검출만 하고 값을 바꾸지 않는다 (사람 판단·도구 기록 원칙).
 */

export const ANOMALY_KINDS = ['area-jump', 'length-off-interval', 'area-nonpositive'] as const;

export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

/** 이상 항목 — 종류·사유(한국어)·관련 위치 */
export interface Anomaly {
  kind: AnomalyKind;
  itemKey: string;
  /** 사람이 읽는 사유 (한국어) */
  reason: string;
  /** 관련 chainage (급변은 두 측점, 그 외 단일) */
  chainages_m: number[];
  /** 관련 단면 id (있으면) */
  sectionIds: string[];
}

export interface DetectAnomaliesOptions {
  /** 급변 판정 배수 (기본 3 — 3배 이상 급변) */
  jumpFactor?: number;
  /**
   * 표준 측점 간격(m). 지정 시 연장이 이 값과 크게 다른 구간을 표시.
   * 미지정이면 length-off-interval 검사를 건너뛴다.
   */
  stationInterval_m?: number;
  /** 표준 간격 대비 허용 오차 비율 (기본 0.5 = ±50%) */
  intervalTolerance?: number;
}

/**
 * 두 단면적의 급변 여부 — max/min ≥ jumpFactor.
 * 한쪽이 0 이면 area-nonpositive 로 별도 검출되므로 여기서는 급변 판정에서 제외.
 */
function isJump(a: number, b: number, jumpFactor: number): boolean {
  if (a <= 0 || b <= 0) {
    return false;
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi / lo >= jumpFactor;
}

/**
 * 단면·구간에서 이상값을 검출한다.
 *
 * @param sections 측점 단면 목록 (itemKey 혼재 가능)
 * @param segments 구간 목록 (연장 검사에 사용)
 * @param opts 임계값 옵션
 */
export function detectAnomalies(
  sections: StationSection[],
  segments: Segment[],
  opts?: DetectAnomaliesOptions,
): Anomaly[] {
  const jumpFactor = opts?.jumpFactor ?? 3;
  const intervalTolerance = opts?.intervalTolerance ?? 0.5;
  const stationInterval_m = opts?.stationInterval_m;
  const anomalies: Anomaly[] = [];

  // 1) 단면적 0 또는 음수.
  for (const section of sections) {
    if (section.area_m2 <= 0) {
      anomalies.push({
        kind: 'area-nonpositive',
        itemKey: section.itemKey,
        reason: `단면적이 0 이하입니다 (${section.area_m2}㎡, chainage ${section.station.chainage_m}m)`,
        chainages_m: [section.station.chainage_m],
        sectionIds: [section.id],
      });
    }
  }

  // 2) 인접 단면적 3배 이상 급변 — itemKey 별로 정렬 후 인접 비교.
  const byItem = new Map<string, StationSection[]>();
  for (const section of sections) {
    const bucket = byItem.get(section.itemKey);
    if (bucket === undefined) {
      byItem.set(section.itemKey, [section]);
    } else {
      bucket.push(section);
    }
  }
  for (const [itemKey, bucket] of byItem) {
    const sorted = sortSections(bucket);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (isJump(a.area_m2, b.area_m2, jumpFactor)) {
        anomalies.push({
          kind: 'area-jump',
          itemKey,
          reason: `인접 단면적이 ${jumpFactor}배 이상 급변합니다 (${a.area_m2}㎡ → ${b.area_m2}㎡, chainage ${a.station.chainage_m}→${b.station.chainage_m}m)`,
          chainages_m: [a.station.chainage_m, b.station.chainage_m],
          sectionIds: [a.id, b.id],
        });
      }
    }
  }

  // 3) 연장이 표준 측점 간격과 크게 다름.
  if (stationInterval_m !== undefined && stationInterval_m > 0) {
    const lo = stationInterval_m * (1 - intervalTolerance);
    const hi = stationInterval_m * (1 + intervalTolerance);
    for (const seg of segments) {
      // 전/후 불연속(연장 0) 구간은 정상 — 검사 제외.
      if (seg.length_m === 0) {
        continue;
      }
      if (seg.length_m < lo || seg.length_m > hi) {
        anomalies.push({
          kind: 'length-off-interval',
          itemKey: seg.itemKey,
          reason: `구간 연장이 표준 측점 간격(${stationInterval_m}m)과 크게 다릅니다 (${seg.length_m}m, chainage ${seg.from.chainage_m}→${seg.to.chainage_m}m)`,
          chainages_m: [seg.from.chainage_m, seg.to.chainage_m],
          sectionIds: [],
        });
      }
    }
  }

  return anomalies;
}
