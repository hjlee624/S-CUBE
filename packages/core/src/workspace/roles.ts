import type { DrawingRole } from '@s-cube/schema';

/**
 * 도면 파일명에서 역할(DrawingRole)을 추정한다.
 *
 * 실도면 파일명 예: "050. 여수로 계획 평면도", "052. 여수로 굴착 종단면도",
 * "053. 여수로 굴착 횡단면도(1)". 번호 접두("050. ")·확장자·대소문자는 무시한다.
 *
 * 키워드 우선순위 주의:
 * - '횡단'과 '종단'은 둘 다 '단'을 포함하므로 접두 글자('횡'/'종')로 정확히 구분한다.
 * - '표준' 또는 '상세' → standard-detail.
 * - 매칭이 없으면 other.
 *
 * @param fileName 원본 파일명 (경로·확장자 포함 가능)
 * @returns 추정 역할. 확신 불가 시 'other'.
 */
export function suggestRoleFromName(fileName: string): DrawingRole {
  const normalized = stripExtension(fileName).toLowerCase();

  // '횡단'이 '종단'보다 먼저 검사되어도 서로 배타적이므로 순서 무관하지만,
  // '단면'만 있고 접두가 없는 경우를 대비해 명시 키워드부터 확인한다.
  if (normalized.includes('횡단')) return 'cross-section';
  if (normalized.includes('종단')) return 'profile';
  if (normalized.includes('평면')) return 'plan';
  if (normalized.includes('표준') || normalized.includes('상세')) return 'standard-detail';

  return 'other';
}

/** 확장자 제거 — 파일명 끝의 마지막 '.xxx' 한 개만 떼어낸다 (경로 구분자 뒤 기준). */
function stripExtension(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  // 선행 점(번호 접두 "050.")이나 확장자 없는 경우를 보호: 마지막 점 이후가 짧은 토큰일 때만 확장자로 간주.
  if (dot > 0) {
    const ext = base.slice(dot + 1);
    if (/^[a-z0-9]{1,5}$/i.test(ext)) return base.slice(0, dot);
  }
  return base;
}
