/**
 * 측점 파생 — @s-cube/core 어댑터 (Phase 3-C).
 *
 * 단일 진실원천(single source of truth): 측점 파싱·정렬·구간 체적·이상 감지의 실제
 * 계산 로직은 전부 @s-cube/core 의 station/ 모듈에 있다(21-CONVENTIONS §4 — 계산 로직은
 * packages/core 에만). 이 파일은 core 계약을 앱 UI 가 이미 쓰는 형태로 얇게 변환만 한다:
 *   - 앱은 area_m2 가 필수인 StationSection 을 다루지만, core 는 결측(전/후 불연속의
 *     (전) 단면 누락 등)을 area_m2: undefined 로 표현한다. 여기서 비유한·음수 면적을
 *     결측(undefined)으로 사상해 core 로 넘긴다 — 곡성 No.8+0.000(전) 결측 승격이
 *     '실제 실행 경로'에서 그대로 동작하게 한다.
 *   - core 의 SegmentError(reason 유니온)를 셀 배지가 쓰는 kind 로, Anomaly(sectionIds
 *     배열)를 셀 단위(sectionId)로 평탄화한다.
 *
 * 계산·규칙은 여기서 새로 만들지 않는다. 규칙이 바뀌면 core 만 고친다.
 * 이 모듈은 canvas/store 에 의존하지 않는 순수 함수 모음이다.
 */

import {
  type Anomaly as CoreAnomaly,
  type BuildSegmentsResult as CoreBuildResult,
  type SegmentError as CoreSegmentError,
  buildSegments as coreBuildSegments,
  detectAnomalies as coreDetectAnomalies,
  type SectionInput,
} from '@s-cube/core';
import type { Segment, StationSection } from '@s-cube/schema';

// ─────────────────────────────────────────────────────────────────────────────
// 파싱·정렬 — core 계약을 그대로 재노출 (변환 불필요)
// ─────────────────────────────────────────────────────────────────────────────

export {
  isStationParseError,
  parseStation,
  type StationParseError,
  type StationParseResult,
  sortSections,
} from '@s-cube/core';

// ─────────────────────────────────────────────────────────────────────────────
// 구간 생성 — core.buildSegments 를 앱 형태로 어댑트
// ─────────────────────────────────────────────────────────────────────────────

/** 셀 배지가 쓰는 결측 에러 유형 — core reason 을 UI 관점으로 축약 */
export type SegmentErrorKind = 'pre-missing' | 'area-invalid';

/** 구간 산출 에러 — 결측·전후불연속 결측 등으로 산출을 차단하는 사유 (앱 표시용) */
export interface SegmentError {
  /** 에러가 걸린 chainage_m (경계값) */
  chainage_m: number;
  itemKey: string;
  /** 실패 사유 (한국어) */
  reason: string;
  /** '(전)' 단면 결측 등 §4 승격 에러 여부 */
  kind: SegmentErrorKind;
}

/**
 * buildSegments 결과 — 구간 목록 + 산출 차단 에러 목록 + 차단 여부.
 *
 * blocked 는 core 가 계산한 값이다(결측 승격 에러 존재 시 true). 소비자는 blocked 를
 * 반드시 확인해 '정상 구간의 부분합'을 표시·저장·export 하지 말아야 한다 — 부분합이
 * 조용히 새어나가는 곡성류 사고를 계산 계층에서 못박는다.
 */
export interface BuildSegmentsResult {
  segments: Segment[];
  errors: SegmentError[];
  blocked: boolean;
}

/** 유한·비음수만 유효한 면적 — 그 외(NaN·음수·미정)는 결측으로 본다 */
function isValidArea(area_m2: number): boolean {
  return Number.isFinite(area_m2) && area_m2 >= 0;
}

/**
 * 앱 StationSection 을 core SectionInput 으로 변환한다.
 * 비유한·음수 면적은 결측(undefined)으로 사상 — core 가 §4 결측 승격을 판단하게 한다.
 */
function toSectionInput(section: StationSection): SectionInput {
  return {
    id: section.id,
    station: section.station,
    itemKey: section.itemKey,
    area_m2: isValidArea(section.area_m2) ? section.area_m2 : undefined,
    ...(section.measurementId !== undefined ? { measurementId: section.measurementId } : {}),
    ...(section.note !== undefined ? { note: section.note } : {}),
  };
}

/** core SegmentError → 앱 SegmentError (kind·chainage·reason 로 축약) */
function toAppSegmentError(err: CoreSegmentError): SegmentError {
  // 전/후 불연속 (전) 결측만 별도 배지('(전) 단면 결측'), 그 외 결측은 '단면적 결측'.
  const isPreDiscontinuity =
    err.reason === 'pre-section-missing-area' && err.message.includes('전/후 불연속');
  return {
    chainage_m: err.chainage_m,
    itemKey: err.itemKey,
    reason: err.message,
    kind: isPreDiscontinuity ? 'pre-missing' : 'area-invalid',
  };
}

/**
 * 한 itemKey 의 단면들로 인접 구간(Segment)을 생성한다 (03-DATA-MODEL §4).
 *
 * 실제 규칙(전/후 불연속·(전) 결측 승격·양단면평균법)은 @s-cube/core 가 수행한다.
 * 여기서는 앱 타입을 core 로 넘기고, 결과 에러를 셀 배지 형태로 축약할 뿐이다.
 *
 * @param sections 대상 단면 배열 (itemKey 로 core 가 필터·정렬)
 * @param itemKey  대상 항목 ('절토' 등)
 * @param method   'average-end-area' | 'prismoidal' (기본 양단면평균법)
 */
export function buildSegments(
  sections: StationSection[],
  itemKey: string,
  method: Segment['method'] = 'average-end-area',
): BuildSegmentsResult {
  const inputs = sections.map(toSectionInput);
  // orphan(단면 1개) 은 앱 표에서는 '2개 이상이면 구간 생성' 안내로 충분하므로
  // 산출 차단 에러로 노이즈를 내지 않는다(비차단).
  const result: CoreBuildResult = coreBuildSegments(inputs, itemKey, method, {
    flagOrphans: false,
  });
  return {
    segments: result.segments,
    errors: result.errors.map(toAppSegmentError),
    blocked: result.blocked,
  };
}

/**
 * 항목 총 체적 — 결측 승격(blocked) 이면 null.
 *
 * core.totalVolume 과 동일한 계약: blocked 면 '정상 구간의 부분합'을 조용히 돌려주지
 * 않고 null 을 준다(곡성류 재발 방지). 소비자는 null 을 '산출 차단'으로 표시해야 한다.
 * (core.totalVolume 은 core BuildSegmentsResult 를 받으므로 여기서는 동일 규칙을
 *  앱 결과 타입으로 그대로 적용한다 — 규칙 분기가 아니라 타입 어댑트일 뿐이다.)
 */
export function totalVolume(result: BuildSegmentsResult): number | null {
  if (result.blocked) {
    return null;
  }
  let sum = 0;
  for (const seg of result.segments) {
    sum += seg.volume_m3;
  }
  return sum;
}

// ─────────────────────────────────────────────────────────────────────────────
// 이상 감지 — core.detectAnomalies 를 셀(sectionId) 단위로 평탄화
// ─────────────────────────────────────────────────────────────────────────────

/** 셀 배지가 쓰는 이상 유형 (UI 관점) */
export type AnomalyKind = 'area-zero-or-negative' | 'area-jump' | 'length-outlier';

/**
 * 이상 항목 — 특정 단면(sectionId) 또는 구간(chainage 경계)에 붙는 경고 배지 근거.
 */
export interface Anomaly {
  kind: AnomalyKind;
  itemKey: string;
  /** 배지를 붙일 단면 id (셀 배지) — 급변·면적0 은 문제 단면을 가리킨다 */
  sectionId?: string;
  /** 구간 경계 chainage (연장 이상은 구간에 붙는다) */
  chainage_m?: number;
  /** 사람이 읽는 사유 (한국어) */
  reason: string;
}

/** core AnomalyKind → 앱 AnomalyKind */
function toAppAnomalyKind(kind: CoreAnomaly['kind']): AnomalyKind {
  if (kind === 'area-nonpositive') return 'area-zero-or-negative';
  if (kind === 'area-jump') return 'area-jump';
  return 'length-outlier';
}

/**
 * 단면·구간에서 이상값을 감지한다 (P3-15).
 *
 * 실제 판정(3배 급변·연장 이탈·면적0/음수)은 @s-cube/core 가 수행한다. 여기서는
 * itemKey 로 필터·정렬된 구간을 core 로 넘겨 이상을 얻고, 셀 배지가 쓰기 좋게
 * sectionId 단위로 평탄화한다(급변은 두 단면 중 종점 단면에 배지를 붙인다).
 *
 * amber 경고 톤 배지 근거만 만들고 산출을 차단하지 않는다.
 */
export function detectAnomalies(
  sections: StationSection[],
  itemKey: string,
  stationInterval_m: number,
): Anomaly[] {
  const forItem = sections.filter((s) => s.itemKey === itemKey);
  // 연장 이상 판정에 필요한 구간을 core 로 만든다(양단면평균법 기준).
  const { segments } = buildSegments(forItem, itemKey);
  const coreAnomalies = coreDetectAnomalies(forItem, segments, {
    stationInterval_m,
  });

  const anomalies: Anomaly[] = [];
  for (const an of coreAnomalies) {
    const kind = toAppAnomalyKind(an.kind);
    if (kind === 'length-outlier') {
      // 연장 이상은 구간 경계(시점 chainage)에 붙는다.
      anomalies.push({
        kind,
        itemKey: an.itemKey,
        chainage_m: an.chainages_m[0],
        reason: an.reason,
      });
      continue;
    }
    // 면적0/음수·급변은 단면 배지 — 급변은 종점 단면(마지막 sectionId)에 붙인다.
    const sectionId = an.sectionIds[an.sectionIds.length - 1];
    anomalies.push({
      kind,
      itemKey: an.itemKey,
      ...(sectionId !== undefined ? { sectionId } : {}),
      reason: an.reason,
    });
  }
  return anomalies;
}
