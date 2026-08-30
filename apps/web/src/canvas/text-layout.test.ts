/**
 * 다중행 텍스트 레이아웃 순수 로직 테스트 — 무회귀(단일행 동일)·하강 오프셋·개행 정규화.
 */
import { describe, expect, it } from 'vitest';
import { isMultiline, layoutTextLines } from './text-layout.ts';

describe('layoutTextLines', () => {
  it('단일행은 한 줄, 첫 줄 오프셋 0 (기존 렌더 무회귀)', () => {
    const lines = layoutTextLines('본 도면의 치수는 mm', 2.5);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('본 도면의 치수는 mm');
    expect(lines[0]?.baselineOffset).toBe(0);
  });

  it('다중행은 줄 수만큼 분할되고 height 배수로 하강한다', () => {
    const lines = layoutTextLines('1행\n2행\n3행', 4);
    expect(lines.map((l) => l.text)).toEqual(['1행', '2행', '3행']);
    expect(lines.map((l) => l.baselineOffset)).toEqual([0, 4, 8]);
  });

  it('lineSpacing 계수가 줄 높이에 곱해진다', () => {
    const lines = layoutTextLines('a\nb', 10, 1.5);
    expect(lines[1]?.baselineOffset).toBe(15);
  });

  it('\\r\\n 과 \\r 을 \\n 으로 정규화한다', () => {
    const crlf = layoutTextLines('x\r\ny', 3);
    expect(crlf.map((l) => l.text)).toEqual(['x', 'y']);
    const cr = layoutTextLines('x\ry', 3);
    expect(cr.map((l) => l.text)).toEqual(['x', 'y']);
  });

  it('빈 줄도 한 줄로 센다 (중간 공백 유지)', () => {
    const lines = layoutTextLines('머리\n\n꼬리', 2);
    expect(lines.map((l) => l.text)).toEqual(['머리', '', '꼬리']);
    expect(lines.map((l) => l.baselineOffset)).toEqual([0, 2, 4]);
  });

  it('빈 문자열은 오프셋 0의 빈 한 줄', () => {
    const lines = layoutTextLines('', 5);
    expect(lines).toEqual([{ text: '', baselineOffset: 0 }]);
  });
});

describe('isMultiline', () => {
  it('개행이 없으면 false', () => {
    expect(isMultiline('한 줄 텍스트')).toBe(false);
    expect(isMultiline('')).toBe(false);
  });

  it('\\n 또는 \\r 이 있으면 true', () => {
    expect(isMultiline('a\nb')).toBe(true);
    expect(isMultiline('a\rb')).toBe(true);
    expect(isMultiline('a\r\nb')).toBe(true);
  });
});
