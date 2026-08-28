/**
 * @s-cube/core 계약 어댑터 — 뷰어가 소비하는 core API를 한 곳에서 재노출한다.
 *
 * core가 아직 병렬 구현 중이므로, 계약 시그니처를 여기서 명시적으로 고정한다.
 * core 구현이 착지하면 이 파일만 타입 검증되고 나머지 앱 코드는 계약 타입으로 검사된다.
 */
import * as core from '@s-cube/core';
import type { Bounds, DrawingModel, NEntity, Vec2 } from '@s-cube/schema';

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
