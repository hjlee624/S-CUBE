/**
 * station/ — 측점 파싱·정렬·불연속 처리·구간 체적 (Phase 3, 03-DATA-MODEL §4)
 *
 * - parse.ts    측점 표기 파싱 + chainage 환산 (실패는 에러로 노출)
 * - sort.ts     chainage 정렬 (pre→null→post) + 중복 검출
 * - segments.ts 인접 측점 구간 생성 + 전/후 불연속 + 체적 FormulaNode
 * - anomaly.ts  이상 감지 (급변·연장 이탈·단면적 0/음수)
 */

export {
  ANOMALY_KINDS,
  type Anomaly,
  type AnomalyKind,
  type DetectAnomaliesOptions,
  detectAnomalies,
} from './anomaly.ts';
export {
  isStationParseError,
  parseStation,
  type StationParseError,
  type StationParseResult,
} from './parse.ts';
export {
  type BuildSegmentsOptions,
  type BuildSegmentsResult,
  buildSegments,
  prismoidalVolume,
  SEGMENT_ERROR_REASONS,
  type SectionInput,
  type SegmentError,
  type SegmentErrorReason,
  segmentVolume,
  totalVolume,
} from './segments.ts';
export {
  type DuplicateGroup,
  detectDuplicates,
  sortSections,
} from './sort.ts';
