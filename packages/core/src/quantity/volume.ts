/**
 * 양단면평균법 — V = (A1 + A2) / 2 × L
 *
 * 인접한 두 측점의 단면적을 평균하고 구간 연장을 곱해 체적을 구한다.
 * 반올림하지 않는다 — 표시 시점에만 반올림한다 (21-CONVENTIONS §4).
 */
export function averageEndArea(a1_m2: number, a2_m2: number, length_m: number): number {
  return ((a1_m2 + a2_m2) / 2) * length_m;
}
