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
  /** 전체 엔티티 경계 (Zoom Extents 용). 엔티티 없으면 null */
  bounds: Bounds | null;
}
