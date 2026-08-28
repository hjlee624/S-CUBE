/**
 * ODA 탐지 — 버전 폴더 자연 정렬(순수 함수)만 검증. 파일시스템 탐지는 환경 의존이라 제외.
 */
import { describe, expect, it } from 'vitest';
import { sortOdaDirsByVersionDesc } from './oda.ts';

describe('sortOdaDirsByVersionDesc', () => {
  it('숫자 자연 정렬 내림차순 — 26.4 > 25.12 > 9.1 (사전순이면 9이 앞서는 함정 회피)', () => {
    const sorted = sortOdaDirsByVersionDesc([
      'ODAFileConverter 9.1.0',
      'ODAFileConverter 25.12.1',
      'ODAFileConverter 26.4.0',
    ]);
    expect(sorted).toEqual([
      'ODAFileConverter 26.4.0',
      'ODAFileConverter 25.12.1',
      'ODAFileConverter 9.1.0',
    ]);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const input = ['b', 'a'];
    sortOdaDirsByVersionDesc(input);
    expect(input).toEqual(['b', 'a']);
  });
});
