import type { NEntity } from './entity.ts';
import type { Bounds } from './geometry.ts';
import type { InsUnits } from './units.ts';

/** 도면 레이어 */
export interface Layer {
  name: string;
  /** ACI 색인 (1~255). 음수로 저장된 경우(레이어 꺼짐)는 절대값으로 정규화 */
  colorIndex: number;
  visible: boolean;
  entityCount: number;
}

/**
 * 정규화 완료된 도면 모델 — 파싱·블록 전개·평탄화 후의 world 좌표 상태.
 * 렌더러와 측정 도구가 소비하는 유일한 형태.
 */
export interface DrawingModel {
  /** AC1015 등 $ACADVER 원값 */
  dxfVersion: string;
  insUnits: InsUnits;
  layers: Layer[];
  entities: NEntity[];
  /** 미지원 엔티티 타입별 개수 — 조용히 버리지 않는다 (P1-2) */
  unsupportedCounts: Record<string, number>;
  /**
   * 좌표 위생처리(비유한·비현실적 초과 좌표)로 폐기·정제된 항목 수 — 조용히 버리지 않는다 (P1-2).
   * 손상 정의점을 가진 엔티티 폐기 1건, 손상 정점 제거로 폐기된 폴리라인 1건 등 각각 1로 집계한다.
   */
  sanitizedCount: number;
  /**
   * 레이아웃(페이퍼 스페이스)에서 제외된 최상위 엔티티 수 — 도곽·표제부 등.
   * 모델 공간 객체만 렌더·측정 대상으로 삼는다(그룹코드 67=1 제외). 조용히 버리지 않는다.
   */
  paperSpaceExcludedCount: number;
  /** 전체 엔티티 경계 (Zoom Extents 용). 엔티티 없으면 null */
  bounds: Bounds | null;
}
