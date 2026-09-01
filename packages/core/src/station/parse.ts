import type { Station } from '@s-cube/schema';

/**
 * 측점 표기 파서 (03-DATA-MODEL §4, P3-1·P3-2).
 *
 * 수용 변형:
 *   'No.8+0.000', 'No.8+000', '8+0.000', 'STA.0+120.5',
 *   'No.8+0.000(전)', 'No.8+0.000(후)', 'No.8+0.000(前)', 'No.8+0.000(後)'
 * 공백·대소문자에 관용적이다.
 *
 * 표기 규칙:
 *   'No.<no>+<plus>' 에서 no 는 측점 번호, '+' 뒤 <plus> 는 시점으로부터의
 *   추가 거리(m). chainage_m = no × stationInterval_m + plus_m.
 *   '+000' 은 0.000(m), '+120.5' 는 120.5(m) — 정수 표기도 그대로 m 로 읽는다.
 *
 * 파싱 실패는 조용히 넘기지 않고 StationParseError 로 돌려준다(P3-1).
 */

/** 파싱 실패 결과 — 판별 유니온의 실패 분기 */
export interface StationParseError {
  ok: false;
  raw: string;
  /** 실패 사유 (한국어) */
  reason: string;
}

/** parseStation 결과 — 성공(Station) 또는 실패(StationParseError) 판별 유니온 */
export type StationParseResult = ({ ok: true } & Station) | StationParseError;

/** 결과가 성공인지 좁히는 타입 가드 */
export function isStationParseError(r: StationParseResult): r is StationParseError {
  return r.ok === false;
}

/**
 * 측점 표기 문자열을 Station 으로 파싱한다.
 *
 * @param raw 원본 표기 (예: 'No.8+0.000(전)')
 * @param stationInterval_m 측점 간격 (프로젝트 설정, 통상 20)
 * @returns 성공 시 { ok:true, ...Station }, 실패 시 StationParseError
 */
export function parseStation(raw: string, stationInterval_m: number): StationParseResult {
  const original = raw;

  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, raw: original, reason: '측점 표기가 비어 있습니다' };
  }
  if (!Number.isFinite(stationInterval_m) || stationInterval_m <= 0) {
    return {
      ok: false,
      raw: original,
      reason: `측점 간격(stationInterval_m)이 유효하지 않습니다: ${stationInterval_m}`,
    };
  }

  // 공백 제거 후 접두 표기(No. / STA.) 를 대소문자 무시로 벗겨낸다.
  let s = raw.replace(/\s+/g, '');

  // 불연속 표기 (전)/(前)/(후)/(後) 추출 — 괄호 유무·전각 괄호 관용.
  let discontinuity: 'pre' | 'post' | null = null;
  const discMatch = s.match(/[([［（]?\s*(전|前|후|後)\s*[)\]］）]?$/);
  if (discMatch !== null) {
    const mark = discMatch[1];
    discontinuity = mark === '전' || mark === '前' ? 'pre' : 'post';
    s = s.slice(0, discMatch.index);
  }

  // 접두어 제거: 'No.', 'No', 'STA.', 'STA', '#' (대소문자 무시)
  s = s.replace(/^(?:no\.?|sta\.?|#)/i, '');

  // 핵심 형태: <no>+<plus>
  const m = s.match(/^(\d+)\+(\d+(?:\.\d+)?)$/);
  if (m === null) {
    return {
      ok: false,
      raw: original,
      reason: `측점 표기 형식을 인식할 수 없습니다: '${original}' (기대 형식 예: 'No.8+0.000')`,
    };
  }

  const noStr = m[1];
  const plusStr = m[2];
  if (noStr === undefined || plusStr === undefined) {
    return { ok: false, raw: original, reason: `측점 번호·추가거리 추출 실패: '${original}'` };
  }

  const no = Number.parseInt(noStr, 10);
  const plus_m = Number.parseFloat(plusStr);
  if (!Number.isFinite(no) || !Number.isFinite(plus_m)) {
    return { ok: false, raw: original, reason: `측점 번호·추가거리 파싱 실패: '${original}'` };
  }

  const chainage_m = no * stationInterval_m + plus_m;

  return {
    ok: true,
    raw: original,
    no,
    plus_m,
    chainage_m,
    discontinuity,
  };
}
