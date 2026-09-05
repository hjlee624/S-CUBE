/**
 * @s-cube/core — 순수 계산 로직
 *
 * 브라우저·서버 공용. DOM·Node API에 의존하지 않는다.
 * - dxf/      DXF 파싱·정규화·블록 전개 (Phase 1)
 * - geometry/ shoelace·bulge·폐합·히트테스트 (Phase 2)
 * - quantity/ 양단면평균법·단위 환산·할증 (Phase 3~4)
 * - station/  측점 파싱·정렬·불연속 처리 (Phase 3)
 */

// dxf/ — 파싱 파이프라인
export { aciToRgb } from './dxf/aci.ts';
export {
  MAX_INSERT_DEPTH,
  UNSUPPORTED_KEY_DEPTH_EXCEEDED,
  UNSUPPORTED_KEY_MISSING_BLOCK,
} from './dxf/expand.ts';
export { parseAndNormalizeDxf } from './dxf/pipeline.ts';
export {
  dwgDatabaseToDxf,
  type DwgLikeDatabase,
  type DwgLikeEntity,
  type DwgToDxfResult,
} from './dwg/dwg-to-dxf.ts';
// geometry/ — 렌더·측정 공용 프리미티브
export {
  bulgeSegmentArea,
  hatchArea,
  isImplicitlyClosed,
  netAreaWithHoles,
  pointInPolygon,
  polygonArea,
  polygonSignedArea,
  signedArea,
} from './geometry/area.ts';
export { entityBounds, mergeBounds } from './geometry/bounds.ts';
export { distancePointToPolyline, distancePointToSegment } from './geometry/hittest.ts';
export {
  applyMat3,
  composeMat3,
  IDENTITY_MAT3,
  mat3FromInsert,
} from './geometry/mat3.ts';
export { bulgeToArc, distance, polylineLength } from './geometry/primitives.ts';
export { areaBetweenProfiles, type ProfileAreaResult } from './geometry/profile-area.ts';
export { isSelfIntersecting } from './geometry/validity.ts';
export {
  autoCloseEntities,
  buildSnapGraph,
  findClosedFaces,
  type ClosedFace,
  type SnapEdge,
  type SnapGraph,
  type SnapNode,
} from './geometry/auto-close.ts';
export { boundaryAtPoint, type BoundaryFace } from './geometry/boundary-at-point.ts';
export { splitAtIntersections } from './geometry/intersect-split.ts';
export {
  enumerateFaces,
  faceContainingPoint,
  facesInRegion,
  MAX_REGION_SEGMENTS,
  type Rect,
  type TracedFace,
} from './geometry/planar-faces.ts';
export {
  detectSectionPairs,
  groupBySimilarity,
  type EntityGroup,
  type SectionPairCandidate,
  type SectionProfile,
} from './geometry/group-candidates.ts';
export {
  buildRuleCandidates,
  globMatch,
  matchLayerRules,
  type LayerRuleCandidate,
  type LayerRuleMatch,
} from './geometry/layer-rules.ts';
// quantity/
export {
  applyLoss,
  areaThickness,
  CALC_BUILDERS,
  CALC_TYPE_OF,
  type CalcBuilderName,
  contactLength,
  convertUnit,
  countTimes,
  derivedContact,
  derivedScaffold,
  derivedShore,
  sectionLength,
} from './quantity/calc.ts';
export {
  evaluate,
  fAdd,
  fAvgEndArea,
  fConst,
  fDiv,
  fLoss,
  fMul,
  fRef,
  fRound,
  fSub,
  fSum,
  type RefResolver,
  renderText,
} from './quantity/formula.ts';
export { MATERIAL_PRESETS } from './quantity/presets.ts';
export { averageEndArea } from './quantity/volume.ts';
// station/ — 측점 파싱·정렬·불연속 처리·구간 체적 (Phase 3)
export {
  ANOMALY_KINDS,
  type Anomaly,
  type AnomalyKind,
  type BuildSegmentsOptions,
  type BuildSegmentsResult,
  buildSegments,
  type DetectAnomaliesOptions,
  type DuplicateGroup,
  detectAnomalies,
  detectDuplicates,
  isStationParseError,
  parseStation,
  prismoidalVolume,
  SEGMENT_ERROR_REASONS,
  type SectionInput,
  type SegmentError,
  type SegmentErrorReason,
  type StationParseError,
  type StationParseResult,
  segmentId,
  segmentVolume,
  sortSections,
  totalVolume,
} from './station/index.ts';
// workspace/ — 도면 역할 분류 + 산출 전 필수도면 체크리스트
export {
  type ChecklistItem,
  type ChecklistResult,
  evaluateChecklist,
  type Requirement,
  suggestRoleFromName,
  TAKEOFF_REQUIREMENTS,
} from './workspace/index.ts';
