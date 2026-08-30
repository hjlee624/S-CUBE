import { describe, expect, it } from 'vitest';
import { suggestRoleFromName } from './roles.ts';

describe('suggestRoleFromName — 실도면 파일명 역할 추정', () => {
  it('실도면 파일명 6종 정확 분류 (번호접두 포함)', () => {
    expect(suggestRoleFromName('050. 여수로 계획 평면도')).toBe('plan');
    expect(suggestRoleFromName('052. 여수로 굴착 종단면도')).toBe('profile');
    expect(suggestRoleFromName('053. 여수로 굴착 횡단면도(1)')).toBe('cross-section');
    expect(suggestRoleFromName('080. 옹벽 표준도')).toBe('standard-detail');
    expect(suggestRoleFromName('081. 배수구조물 상세도')).toBe('standard-detail');
    expect(suggestRoleFromName('001. 공사 개요 및 위치')).toBe('other');
  });

  it("'횡단면도' vs '종단면도' 명확히 구분 (둘 다 '단' 포함)", () => {
    expect(suggestRoleFromName('여수로 횡단면도')).toBe('cross-section');
    expect(suggestRoleFromName('여수로 종단면도')).toBe('profile');
    // 한 이름에 둘 다 있으면 횡단이 우선(단면적 취득이 산출 핵심)
    expect(suggestRoleFromName('횡단 및 종단 비교도')).toBe('cross-section');
  });

  it('번호접두 무시 — "NNN. " 접두가 있어도 동일 분류', () => {
    expect(suggestRoleFromName('053. 여수로 굴착 횡단면도(1)')).toBe(
      suggestRoleFromName('여수로 굴착 횡단면도(1)'),
    );
    expect(suggestRoleFromName('7. 평면도')).toBe('plan');
    expect(suggestRoleFromName('999. 종단면도')).toBe('profile');
  });

  it('확장자 무시 — .dwg / .dxf / .pdf', () => {
    expect(suggestRoleFromName('053. 여수로 굴착 횡단면도(1).dwg')).toBe('cross-section');
    expect(suggestRoleFromName('052. 여수로 굴착 종단면도.dxf')).toBe('profile');
    expect(suggestRoleFromName('050. 여수로 계획 평면도.pdf')).toBe('plan');
  });

  it('경로 구분자 무시 — 폴더 경로가 붙어도 파일명 기준', () => {
    expect(suggestRoleFromName('C:/도면/여수로/053. 횡단면도.dwg')).toBe('cross-section');
    expect(suggestRoleFromName('도면\\여수로\\평면도.dxf')).toBe('plan');
  });

  it('대소문자·확장자 조합 무관 (한글 키워드는 대소문자 없음, 확장자 대문자)', () => {
    expect(suggestRoleFromName('여수로 표준도.DWG')).toBe('standard-detail');
    expect(suggestRoleFromName('상세도.DXF')).toBe('standard-detail');
  });

  it('무관 도면·키워드 없음 → other', () => {
    expect(suggestRoleFromName('일반도')).toBe('other');
    expect(suggestRoleFromName('물량산출서')).toBe('other');
    expect(suggestRoleFromName('')).toBe('other');
  });
});
