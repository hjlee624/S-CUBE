/** 2D 좌표 (도면 좌표계) */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 2D 아핀 변환 행렬 (row-major 6요소):
 * [a, b, tx, c, d, ty] → x' = a·x + b·y + tx, y' = c·x + d·y + ty
 * 블록(INSERT) 재귀 전개 시 위치·스케일·회전 누적에 사용.
 */
export type Mat3 = readonly [number, number, number, number, number, number];

/** 축 정렬 경계 상자 (도면 좌표계) */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
