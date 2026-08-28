/**
 * dxf-parser(v1.1.2) 출력의 소비용 좁힌 타입.
 *
 * 공식 타입 선언(IDxf 등)은 런타임과 어긋나는 부분이 있어(예: handle은 그룹코드 5가
 * 문자열로 파싱되지만 number로 선언됨, 대부분의 필드가 실제로는 미존재 가능) 여기서
 * 모든 필드를 optional·정확한 런타임 타입으로 다시 선언하고 경계에서 한 번만 캐스팅한다.
 */

export interface RawPoint {
  x?: number;
  y?: number;
  z?: number;
}

export interface RawEntityBase {
  type?: string;
  /** 그룹코드 5 → 문자열. 파일에 없으면 파서가 순번(number)을 채운다 */
  handle?: string | number;
  layer?: string;
  colorIndex?: number;
  visible?: boolean;
}

export interface RawVertex extends RawPoint {
  bulge?: number;
}

export interface RawLineEntity extends RawEntityBase {
  vertices?: RawPoint[];
}

/** LWPOLYLINE·POLYLINE 공통 소비 형태 — shape = closed 플래그 */
export interface RawPolylineEntity extends RawEntityBase {
  vertices?: RawVertex[];
  shape?: boolean;
}

export interface RawArcEntity extends RawEntityBase {
  center?: RawPoint;
  radius?: number;
  /** dxf-parser가 도(deg)를 라디안으로 변환해서 준다 */
  startAngle?: number;
  endAngle?: number;
}

export interface RawCircleEntity extends RawEntityBase {
  center?: RawPoint;
  radius?: number;
}

export interface RawTextEntity extends RawEntityBase {
  startPoint?: RawPoint;
  textHeight?: number;
  /** 도(deg) 원값 */
  rotation?: number;
  text?: string;
}

export interface RawMtextEntity extends RawEntityBase {
  position?: RawPoint;
  height?: number;
  /** 도(deg) 원값 */
  rotation?: number;
  text?: string;
}

export interface RawDimensionEntity extends RawEntityBase {
  anchorPoint?: RawPoint;
  linearOrAngularPoint1?: RawPoint;
  linearOrAngularPoint2?: RawPoint;
  /** 그룹코드 42 — 좌표 실측값 (도면 단위) */
  actualMeasurement?: number;
  /** 그룹코드 1 — 사용자가 명시한 치수 텍스트 ('<>'는 실측값 표시) */
  text?: string;
}

export interface RawSolidEntity extends RawEntityBase {
  points?: RawPoint[];
}

export interface RawInsertEntity extends RawEntityBase {
  name?: string;
  xScale?: number;
  yScale?: number;
  position?: RawPoint;
  /** 도(deg) 원값 */
  rotation?: number;
  columnCount?: number;
  rowCount?: number;
  columnSpacing?: number;
  rowSpacing?: number;
}

export interface RawBlock {
  name?: string;
  /** 블록 기준점 (그룹코드 10/20) */
  position?: RawPoint;
  entities?: RawEntityBase[];
}

export interface RawLayer {
  name?: string;
  /** 파서가 이미 절대값으로 정규화 (음수 = 레이어 꺼짐 → visible false) */
  colorIndex?: number;
  visible?: boolean;
  frozen?: boolean;
}

export interface RawDxf {
  /** '$ACADVER' → 문자열, '$INSUNITS' → 숫자 등 헤더 변수 원값 */
  header?: Record<string, unknown>;
  entities?: RawEntityBase[];
  blocks?: Record<string, RawBlock>;
  tables?: {
    layer?: {
      layers?: Record<string, RawLayer>;
    };
  };
}
