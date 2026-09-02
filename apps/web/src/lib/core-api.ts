/**
 * @s-cube/core 계약 어댑터 — 뷰어가 소비하는 core API를 한 곳에서 재노출한다.
 *
 * core가 아직 병렬 구현 중이므로, 계약 시그니처를 여기서 명시적으로 고정한다.
 * core 구현이 착지하면 이 파일만 타입 검증되고 나머지 앱 코드는 계약 타입으로 검사된다.
 */
import * as core from '@s-cube/core';
import type { Bounds, DrawingModel, Loop, NEntity, PVertex, Vec2 } from '@s-cube/schema';

/** bulge 세그먼트 → 원호 변환 결과 (각도 라디안, ccw = 반시계) */
export interface BulgeArc {
  center: Vec2;
  r: number;
  a0: number;
  a1: number;
  ccw: boolean;
}

/** DXF 텍스트 → 정규화 완료 DrawingModel */
export const parseAndNormalizeDxf: (text: string) => DrawingModel = core.parseAndNormalizeDxf;

/** 폴리라인 bulge 세그먼트를 원호(중심/반지름/각도)로 변환 */
export const bulgeToArc: (a: Vec2, b: Vec2, bulge: number) => BulgeArc = core.bulgeToArc;

/** 엔티티 경계 상자 (도면 좌표). 계산 불가 시 null */
export const entityBounds: (e: NEntity) => Bounds | null = core.entityBounds;

/** 경계 상자 병합 */
export const mergeBounds: (list: (Bounds | null)[]) => Bounds | null = core.mergeBounds;

/** ACI 색인 → '#rrggbb' */
export const aciToRgb: (index: number) => string = core.aciToRgb;

/** 두 점 사이 거리 */
export const distance: (a: Vec2, b: Vec2) => number = core.distance;

/**
 * Phase 2 측정 기하 계약 (P2-1~5) — core `geometry/` 순수 함수 재노출.
 *
 * 여기서 계약 시그니처를 명시적으로 고정한다: core 구현의 시그니처가 이 타입과 어긋나면
 * 이 파일만 타입 오류가 나고, 나머지 앱 코드는 계약 타입으로만 검사된다(중복 구현 금지·
 * 단일 계약 지점). 면적 반환값은 모두 **도면 단위²**(캘리브레이션 미적용) — 단위 환산은
 * web 경계(lib/measure.ts)에서 1회만 수행한다.
 */

/** 폐합 폴리라인/루프 면적 (도면단위²) — shoelace + bulge 활꼴 보정, 절대값 */
export const polygonArea: (vertices: PVertex[], closed: boolean) => number = core.polygonArea;

/** HATCH 경계 루프 순면적 (도면단위²) — 외곽 − island(even-odd) */
export const hatchArea: (loops: Loop[]) => number = core.hatchArea;

/** 외곽 − 구멍들 순면적 (도면단위²) */
export const netAreaWithHoles: (outer: PVertex[], holes: PVertex[][]) => number =
  core.netAreaWithHoles;

/** 폐합 폴리곤 내부 판정 (ray casting, 경계 tolerance 처리) */
export const pointInPolygon: (p: Vec2, vertices: PVertex[]) => boolean = core.pointInPolygon;

/**
 * 열린 폴리라인이 면적 계산 시 암묵 폐합되는가 (closed=false 이고 시점≠종점).
 * true면 web 측정(P2-12)에서 시점-종점 강제폐합 면적 + '폐합되지 않음' 경고 대상.
 */
export const isImplicitlyClosed: (vertices: PVertex[], closed: boolean) => boolean =
  core.isImplicitlyClosed;

/** 점-선분 최단거리 (도면 단위) */
export const distancePointToSegment: (p: Vec2, a: Vec2, b: Vec2) => number =
  core.distancePointToSegment;

/** 점-폴리라인 최단거리 (도면 단위) — closed면 폐합 세그먼트 포함 */
export const distancePointToPolyline: (p: Vec2, vertices: PVertex[], closed: boolean) => number =
  core.distancePointToPolyline;

/** 폴리라인 자기교차 여부 (면적 신뢰성 경고용) */
export const isSelfIntersecting: (vertices: PVertex[]) => boolean = core.isSelfIntersecting;

/** 폴리라인 길이 (직선 + bulge 호장, 도면 단위) — core 기존 export 재노출 */
export const polylineLength: (vertices: PVertex[], closed: boolean) => number = core.polylineLength;

/**
 * 손상 좌표 진단 — core가 손상된(비유한·초대형) 좌표를 폐기·정제한 엔티티 수.
 *
 * 계약: core가 DrawingModel에 진단 필드 `sanitizedCount: number`를 추가했다. 값이 없거나
 * 비정상(NaN·음수)이면 0으로 정규화해, 표시 로직은 "> 0"만 검사하면 되게 한다.
 */
export function sanitizedCount(model: DrawingModel): number {
  const v = model.sanitizedCount;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 레이아웃 제외 진단 — core가 페이퍼 스페이스(도곽·표제부)에서 제외한 엔티티 수.
 * 모델 공간 객체만 렌더·측정한다. 값이 없거나 비정상이면 0으로 정규화.
 */
export function paperSpaceExcludedCount(model: DrawingModel): number {
  const v = model.paperSpaceExcludedCount;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 고아 블록 진단 — DWG→DXF 변환이 설계 블록을 모델 공간에 놓는 top-level INSERT를
 * 잃어버려, 정의는 됐지만 어떤 배치로도 도달 불가능해 렌더 못 하는 설계 객체 규모.
 * 손실을 조용히 넘기지 않고 사용자에게 조치를 유도한다 (P1-2).
 *
 * 계약: core가 DrawingModel에 `orphanedBlockCount: number`를 추가했다. 값이 없거나
 * 비정상(NaN·Infinity·음수)이면 0으로 정규화해, 표시 로직은 "> 0"만 검사하면 되게 한다
 * (sanitizedCount/paperSpaceExcludedCount와 동일 계약).
 */
export function orphanedBlockCount(model: DrawingModel): number {
  const v = model.orphanedBlockCount;
  return Number.isFinite(v) && v > 0 ? v : 0;
}
