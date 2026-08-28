/**
 * @s-cube/schema — 공통 타입 + Zod 스키마
 *
 * 데이터 모델 전체 정의는 PLAN/03-DATA-MODEL.md 참조.
 * 길이 단위는 내부적으로 항상 미터(m)로 정규화한다.
 */

export { type Calibration, CalibrationSchema } from './calibration.ts';
export type { DrawingModel, Layer } from './drawing.ts';
export type {
  EntityHandle,
  EntityOrigin,
  Loop,
  NArc,
  NCircle,
  NDimension,
  NEntity,
  NHatch,
  NLine,
  NPolyline,
  NText,
  PVertex,
} from './entity.ts';
export type { Bounds, Mat3, Vec2 } from './geometry.ts';
export {
  INS_UNITS_TO_METERS,
  type InsUnits,
  insUnitsLabel,
} from './units.ts';
export { SCHEMA_VERSION } from './version.ts';
