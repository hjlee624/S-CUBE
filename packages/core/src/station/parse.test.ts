import { describe, expect, it } from 'vitest';
import { isStationParseError, parseStation } from './parse.ts';

describe('parseStation — 변형 수용 (P3-1)', () => {
  it("'No.8+0.000' (interval 20) → no 8, plus 0, chainage 160", () => {
    const r = parseStation('No.8+0.000', 20);
    expect(isStationParseError(r)).toBe(false);
    if (r.ok) {
      expect(r.no).toBe(8);
      expect(r.plus_m).toBe(0);
      expect(r.chainage_m).toBe(160);
      expect(r.discontinuity).toBe(null);
    }
  });

  it("'No.8+000' (소수 없는 정수 plus) → plus 0", () => {
    const r = parseStation('No.8+000', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.no).toBe(8);
      expect(r.plus_m).toBe(0);
      expect(r.chainage_m).toBe(160);
    }
  });

  it("'8+0.000' (No 접두 없음)", () => {
    const r = parseStation('8+0.000', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.no).toBe(8);
      expect(r.plus_m).toBe(0);
      expect(r.chainage_m).toBe(160);
    }
  });

  it("'STA.0+120.5' → no 0, plus 120.5, chainage 120.5", () => {
    const r = parseStation('STA.0+120.5', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.no).toBe(0);
      expect(r.plus_m).toBe(120.5);
      expect(r.chainage_m).toBe(120.5);
    }
  });

  it("'+120' 은 120.5 아니라 120.0 (m) — 정수 표기 그대로 m", () => {
    const r = parseStation('No.3+120', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plus_m).toBe(120);
      expect(r.chainage_m).toBe(3 * 20 + 120);
    }
  });

  it('공백·대소문자 관용: " no.8 + 0.000 "', () => {
    const r = parseStation(' no.8 + 0.000 ', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.no).toBe(8);
      expect(r.chainage_m).toBe(160);
    }
  });

  it("'sta0+50' (구분점·대소문자 없이)", () => {
    const r = parseStation('sta0+50', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.no).toBe(0);
      expect(r.plus_m).toBe(50);
    }
  });
});

describe('parseStation — 전/후 불연속 표기', () => {
  it("'No.8+0.000(전)' → discontinuity 'pre'", () => {
    const r = parseStation('No.8+0.000(전)', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discontinuity).toBe('pre');
      expect(r.chainage_m).toBe(160);
    }
  });

  it("'No.8+0.000(후)' → discontinuity 'post'", () => {
    const r = parseStation('No.8+0.000(후)', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discontinuity).toBe('post');
    }
  });

  it("'No.8+0.000(前)' 한자 전 → 'pre'", () => {
    const r = parseStation('No.8+0.000(前)', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discontinuity).toBe('pre');
    }
  });

  it("'No.8+0.000(後)' 한자 후 → 'post'", () => {
    const r = parseStation('No.8+0.000(後)', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discontinuity).toBe('post');
    }
  });

  it('전각 괄호 관용: "No.8+0.000（전）"', () => {
    const r = parseStation('No.8+0.000（전）', 20);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.discontinuity).toBe('pre');
    }
  });
});

describe('parseStation — chainage 환산 (interval 20 기준)', () => {
  it('No.8+0.000 = 160, No.8+10.5 = 170.5', () => {
    const a = parseStation('No.8+0.000', 20);
    const b = parseStation('No.8+10.5', 20);
    expect(a.ok && a.chainage_m).toBe(160);
    expect(b.ok && b.chainage_m).toBe(170.5);
  });

  it('interval 25 → No.4+5 = 105', () => {
    const r = parseStation('No.4+5', 25);
    expect(r.ok && r.chainage_m).toBe(105);
  });
});

describe('parseStation — 실패는 조용히 넘기지 않고 에러 반환 (P3-1)', () => {
  it('빈 문자열 → 에러', () => {
    const r = parseStation('', 20);
    expect(isStationParseError(r)).toBe(true);
    if (!r.ok) {
      expect(r.reason).toContain('비어');
    }
  });

  it('형식 불일치 → 에러 (원본 raw 보존)', () => {
    const r = parseStation('완전히엉뚱한값', 20);
    expect(isStationParseError(r)).toBe(true);
    if (!r.ok) {
      expect(r.raw).toBe('완전히엉뚱한값');
      expect(r.reason).toContain('인식할 수 없습니다');
    }
  });

  it("plus 구간 없는 'No.8' → 에러", () => {
    const r = parseStation('No.8', 20);
    expect(isStationParseError(r)).toBe(true);
  });

  it('유효하지 않은 stationInterval_m → 에러', () => {
    const r = parseStation('No.8+0.000', 0);
    expect(isStationParseError(r)).toBe(true);
    if (!r.ok) {
      expect(r.reason).toContain('측점 간격');
    }
  });
});
