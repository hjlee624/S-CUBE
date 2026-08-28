/** DXF $INSUNITS 헤더 원값 (0=단위없음, 1=인치, 4=밀리미터, 5=센티미터, 6=미터 …) */
export type InsUnits = number;

/**
 * $INSUNITS → 미터 환산 계수. 정의되지 않은 값은 undefined (단위 불명 → 캘리브레이션 필수).
 * 참조: DXF 스펙 INSUNITS 코드표.
 */
export const INS_UNITS_TO_METERS: Readonly<Record<number, number>> = {
  1: 0.0254, // 인치
  2: 0.3048, // 피트
  4: 0.001, // 밀리미터
  5: 0.01, // 센티미터
  6: 1, // 미터
  7: 1000, // 킬로미터
  8: 0.0000254, // 마이크로인치
  9: 0.0254 / 1000, // mil
  10: 0.9144, // 야드
  11: 1e-10, // 옹스트롬
  12: 1e-9, // 나노미터
  13: 1e-6, // 마이크로미터
  14: 0.1, // 데시미터
  15: 10, // 데카미터
  16: 100, // 헥토미터
  17: 1e9, // 기가미터
};

/** UI 표시용 단위 이름 */
export function insUnitsLabel(u: InsUnits): string {
  const labels: Record<number, string> = {
    0: '단위 없음',
    1: '인치(in)',
    2: '피트(ft)',
    4: '밀리미터(mm)',
    5: '센티미터(cm)',
    6: '미터(m)',
    7: '킬로미터(km)',
    10: '야드(yd)',
    14: '데시미터(dm)',
  };
  return labels[u] ?? `알 수 없음(${u})`;
}
