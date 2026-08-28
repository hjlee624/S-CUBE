/**
 * 도면별 캘리브레이션 localStorage 저장·복원 (P1-13).
 * 키 = 파일명 + 엔티티 수 + bounds 해시 — 같은 도면을 다시 열면 복원된다.
 */
import { type Bounds, type Calibration, CalibrationSchema } from '@s-cube/schema';

/** FNV-1a 32bit 문자열 해시 — 순수 함수 (테스트 대상) */
export function fnv1aHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * localStorage 키 생성 — 순수 함수.
 * bounds는 부동소수 미세 차이를 무시하도록 유효숫자 9자리로 반올림 후 해시.
 */
export function calibrationStorageKey(
  fileName: string,
  entityCount: number,
  bounds: Bounds | null,
): string {
  const boundsSig = bounds
    ? [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map((n) => n.toPrecision(9)).join(',')
    : 'empty';
  return `s-cube:cal:v1:${fnv1aHash(`${fileName}|${entityCount}|${boundsSig}`)}`;
}

/** 저장 — Zod 검증 후 직렬화. 실패 시 false */
export function saveCalibration(key: string, calibration: Calibration): boolean {
  try {
    const validated = CalibrationSchema.parse(calibration);
    localStorage.setItem(key, JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}

/** 복원 — 없거나 Zod 검증 실패 시 null (손상 데이터는 조용히 무시) */
export function loadCalibration(key: string): Calibration | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return CalibrationSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
