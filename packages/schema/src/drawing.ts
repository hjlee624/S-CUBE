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
  /**
   * DWG 변환이 배치 INSERT를 잃어 렌더 못 하는 고아 블록의 엔티티 수 추정 — 조용히 버리지 않기.
   *
   * 일부 DWG→DXF 변환기(LibreDWG 등)는 설계 블록을 모델 공간에 배치하는 top-level INSERT를
   * 잃어버린다. 그 결과 블록 정의는 남지만 어떤 top-level INSERT로도 도달할 수 없어 렌더·측정에서
   * 통째로 빠지는 대형 블록이 생긴다. 이 값은 그런 도달 불가 대형 블록들의 엔티티 총합으로,
   * 손실 규모를 사용자에게 경고하는 데 쓴다. 고아 없으면 0.
   */
  orphanedBlockCount: number;
  /** 전체 엔티티 경계 (Zoom Extents 용). 엔티티 없으면 null */
  bounds: Bounds | null;
}
