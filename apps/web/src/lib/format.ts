/**
 * 표시용 포맷터 — 반올림은 오직 여기(표시 시점)에서만 한다.
 * 내부 계산은 항상 full precision 유지.
 */

/** world 좌표 표시 (상태바) */
export function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 100000) return n.toFixed(1);
  if (abs >= 1000) return n.toFixed(2);
  return n.toFixed(3);
}

/** 미터 표시 */
export function formatMeters(m: number, digits = 3): string {
  if (!Number.isFinite(m)) return '—';
  return `${m.toFixed(digits)} m`;
}

/** 축척 표시: "1 도면단위 = 0.001 m" */
export function formatScaleLabel(scale_mPerUnit: number): string {
  if (!Number.isFinite(scale_mPerUnit) || scale_mPerUnit <= 0) return '축척 미설정';
  const abs = Math.abs(scale_mPerUnit);
  const text =
    abs >= 0.0001 && abs < 100000
      ? trimTrailingZeros(scale_mPerUnit)
      : scale_mPerUnit.toExponential(4);
  return `1 도면단위 = ${text} m`;
}

/** 오차 % 표시 (부호 유지) */
export function formatErrorPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(3)}%`;
}

function trimTrailingZeros(n: number): string {
  const s = n.toPrecision(6);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 정수 천단위 구분 */
export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR');
}

/** 단면적 표시 (㎡) — 4자리, 반올림은 표시 시점만 (P2-14 정책 준용) */
export function formatArea(m2: number, digits = 4): string {
  if (!Number.isFinite(m2)) return '—';
  return `${m2.toFixed(digits)} ㎡`;
}

/** 체적 표시 (㎥) — 표시 반올림, 내부는 full precision */
export function formatVolume(m3: number, digits = 3): string {
  if (!Number.isFinite(m3)) return '—';
  return `${m3.toFixed(digits)} ㎥`;
}

/** chainage(m) 라벨 — 소수 3자리 */
export function formatChainage(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return `${m.toFixed(3)} m`;
}
