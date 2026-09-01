/**
 * 도면별 캘리브레이션 localStorage 저장·복원 (P1-13) + 도면 무결성 지문 (P4-17).
 * 캘리브레이션 키 = 파일명 + 엔티티 수 + bounds 해시 — 같은 도면을 다시 열면 복원된다.
 */
import {
  type Bounds,
  type Calibration,
  CalibrationSchema,
  type DrawingModel,
} from '@s-cube/schema';

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
 * localStorage 키 생성 — 순수 함수. (캘리브레이션 영속 전용, 안정성 위해 형태 고정)
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

/** 한 정규화 엔티티의 지오메트리 지문 성분 — 좌표가 바뀌면 달라지게 핵심 좌표를 나열 */
function entitySignature(e: DrawingModel['entities'][number]): string {
  const p = (v: { x: number; y: number }) => `${v.x.toPrecision(9)},${v.y.toPrecision(9)}`;
  switch (e.kind) {
    case 'line':
      return `L:${e.handle}:${p(e.a)}:${p(e.b)}`;
    case 'polyline':
      return `P:${e.handle}:${e.closed ? 'c' : 'o'}:${e.vertices
        .map((v) => `${p(v.p)}~${v.bulge.toPrecision(6)}`)
        .join('|')}`;
    case 'arc':
      return `A:${e.handle}:${p(e.center)}:${e.r.toPrecision(9)}:${e.a0.toPrecision(6)}:${e.a1.toPrecision(6)}`;
    case 'circle':
      return `C:${e.handle}:${p(e.center)}:${e.r.toPrecision(9)}`;
    case 'hatch':
      return `H:${e.handle}:${e.loops
        .map((lp) => lp.vertices.map((v) => p(v.p)).join('|'))
        .join('#')}`;
    case 'text':
      return `T:${e.handle}:${p(e.pos)}:${e.value}`;
    case 'dimension':
      return `D:${e.handle}:${e.measuredRaw.toPrecision(9)}:${e.defPoints.map(p).join('|')}`;
  }
}

/**
 * 도면 내용 지문 (P4-17) — 파일명 + 엔티티 지오메트리 다이제스트 + bounds 로 FNV-1a 해시.
 *
 * calibrationStorageKey(파일명+엔티티수+bounds) 보다 강하다: 엔티티 수·bounds 가 같아도
 * 도형(좌표)만 바뀐 도면을 감지한다(좌표 이동 없이 값만 수정 등). 다만 원본 파일 바이트의
 * SHA-256 은 아니다(웹은 원본 바이트 미보관) — 정규화 후 지오메트리 기준 지문이라는 한계는
 * project-file 열기 경로가 사용자에게 안내한다.
 */
export function drawingContentHash(model: DrawingModel): string {
  const boundsSig = model.bounds
    ? [model.bounds.minX, model.bounds.minY, model.bounds.maxX, model.bounds.maxY]
        .map((n) => n.toPrecision(9))
        .join(',')
    : 'empty';
  const geom = model.entities.map(entitySignature).join('\n');
  return `s-cube:dw:v1:${fnv1aHash(`${model.entities.length}|${boundsSig}|${geom}`)}`;
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
