import { describe, expect, it } from 'vitest';
import { aciToRgb } from './aci.ts';

describe('aciToRgb', () => {
  it('기본 7색', () => {
    expect(aciToRgb(1)).toBe('#ff0000');
    expect(aciToRgb(2)).toBe('#ffff00');
    expect(aciToRgb(3)).toBe('#00ff00');
    expect(aciToRgb(4)).toBe('#00ffff');
    expect(aciToRgb(5)).toBe('#0000ff');
    expect(aciToRgb(6)).toBe('#ff00ff');
  });

  it('7번은 흰색', () => {
    expect(aciToRgb(7)).toBe('#ffffff');
  });

  it('회색 계열 끝 값', () => {
    expect(aciToRgb(8)).toBe('#808080');
    expect(aciToRgb(250)).toBe('#333333');
    expect(aciToRgb(255)).toBe('#ffffff');
  });

  it('범위 밖(BYBLOCK=0, BYLAYER=256, 음수, 소수)은 흰색 폴백', () => {
    expect(aciToRgb(0)).toBe('#ffffff');
    expect(aciToRgb(256)).toBe('#ffffff');
    expect(aciToRgb(-3)).toBe('#ffffff');
    expect(aciToRgb(1.5)).toBe('#ffffff');
  });
});
