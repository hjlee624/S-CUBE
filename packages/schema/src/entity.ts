import type { Mat3, Vec2 } from './geometry.ts';

/** DXF handle (그룹코드 5) — 모든 수량의 역추적 키 */
export type EntityHandle = string;

/** 폴리라인 정점. bulge ≠ 0 → 다음 정점까지 원호 세그먼트 (bulge = tan(θ/4)) */
export interface PVertex {
  p: Vec2;
  bulge: number;
}

/** HATCH 경계 루프 */
export interface Loop {
  vertices: PVertex[];
  isOuter: boolean;
}

/** 블록 전개 출처 — 어느 블록 경로에서 어떤 변환으로 나왔는가 */
export interface EntityOrigin {
  blockPath: string[];
  transform: Mat3;
}

interface NBase {
  handle: EntityHandle;
  layer: string;
  /** ACI 색인 (0=BYBLOCK, 256=BYLAYER) */
  colorIndex?: number;
  /** 블록 전개로 생성된 엔티티의 출처 */
  origin?: EntityOrigin;
}

export interface NLine extends NBase {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export interface NPolyline extends NBase {
  kind: 'polyline';
  vertices: PVertex[];
  closed: boolean;
}

export interface NArc extends NBase {
  kind: 'arc';
  center: Vec2;
  r: number;
  /** 시작·끝 각 (라디안, CCW) */
  a0: number;
  a1: number;
}

export interface NCircle extends NBase {
  kind: 'circle';
  center: Vec2;
  r: number;
}

export interface NHatch extends NBase {
  kind: 'hatch';
  loops: Loop[];
}

export interface NText extends NBase {
  kind: 'text';
  pos: Vec2;
  /**
   * 표시 텍스트(평문). MTEXT 서식코드는 디코딩되어 제거되며, \P(문단 나눔)는 '\n'으로
   * 변환되므로 value에는 줄바꿈('\n')이 포함될 수 있다(다중행 텍스트).
   */
  value: string;
  height: number;
  /** 기준선(baseline) 방향각 (라디안, CCW). 미설정 = 0 */
  rotation?: number;
  /**
   * 미러(반전) 블록 전개로 생성된 텍스트 — 글리프가 기준선 기준으로 반사되어야 한다.
   * 렌더러는 이 플래그가 true면 좌우(정확히는 기준선 수직 방향) 반전으로 표시한다.
   */
  mirrored?: boolean;
}

export interface NDimension extends NBase {
  kind: 'dimension';
  defPoints: Vec2[];
  /** 좌표 실측값 (도면 단위) — override 텍스트가 아니라 이 값을 수량에 쓴다 */
  measuredRaw: number;
  /** 치수 텍스트 override — 존재하면 UI에서 경고 배지 */
  textOverride: string | null;
}

/**
 * 정규화 엔티티 — DXF 원본 구조를 그대로 쓰지 않고 이 형태로 평탄화한다.
 * MTEXT→text, SOLID→closed polyline 으로 흡수. 블록은 재귀 전개.
 */
export type NEntity = NLine | NPolyline | NArc | NCircle | NHatch | NText | NDimension;
