/**
 * @s-cube/schema — 공통 타입 + Zod 스키마
 *
 * 데이터 모델 전체 정의는 PLAN/03-DATA-MODEL.md 참조.
 * 길이 단위는 내부적으로 항상 미터(m)로 정규화한다.
 */

/** .scube 프로젝트 파일 스키마 버전 */
export const SCHEMA_VERSION = 1;

/** 2D 좌표 (도면 좌표계) */
export interface Vec2 {
  x: number;
  y: number;
}

/** 2D 아핀 변환 행렬 (row-major: [a, b, tx, c, d, ty]) — 블록 전개용 */
export type Mat3 = readonly [number, number, number, number, number, number];
