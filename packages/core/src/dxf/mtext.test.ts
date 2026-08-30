import { describe, expect, it } from 'vitest';
import { decodeMText } from './mtext.ts';

describe('decodeMText — 진단 실도면 문자열', () => {
  it('색·문단·들여쓰기·높이 제어열 제거 + \\P 줄바꿈', () => {
    const raw =
      '{\\C4;1. 본 도면의 모든 치수는 mm단위이다\\P\\pi-1.40251,l1.40251;2. 시공자는 확인 후 시공한다\\H1.15505x;}';
    expect(decodeMText(raw)).toBe(
      '1. 본 도면의 모든 치수는 mm단위이다\n2. 시공자는 확인 후 시공한다',
    );
  });

  it('한글 인코딩 보존', () => {
    expect(decodeMText('구조물 기초부 굴착면')).toBe('구조물 기초부 굴착면');
  });
});

describe('decodeMText — 스택 분수 \\S', () => {
  it('분자^분모 → 분자/분모', () => {
    expect(decodeMText('\\S1^2;')).toBe('1/2');
  });

  it('# 구분자', () => {
    expect(decodeMText('\\S3#4;')).toBe('3/4');
  });

  it('/ 구분자', () => {
    expect(decodeMText('\\SA/B;')).toBe('A/B');
  });

  it('분모 없으면 분자만 (지수/공차 표기)', () => {
    expect(decodeMText('\\S25^;')).toBe('25');
  });

  it('앞뒤 텍스트와 결합', () => {
    expect(decodeMText('폭 \\S1^2; m')).toBe('폭 1/2 m');
  });
});

describe('decodeMText — 중괄호 그룹', () => {
  it('최외곽 중괄호 unwrap + 여는 제어열 제거, 내용 보존', () => {
    expect(decodeMText('{\\fGulim|b0|i0|c129|p50;M}')).toBe('M');
  });

  it('중첩 중괄호 — 내용 보존, 괄호만 제거', () => {
    expect(decodeMText('{\\C1;외부 {\\C2;내부} 끝}')).toBe('외부 내부 끝');
  });
});

describe('decodeMText — 이스케이프 리터럴', () => {
  it('\\\\ \\{ \\} → 리터럴 \\ { }', () => {
    expect(decodeMText('a\\\\b\\{c\\}d')).toBe('a\\b{c}d');
  });
});

describe('decodeMText — 유니코드 \\U+XXXX', () => {
  it('\\U+00B0 → 도(°) 기호', () => {
    expect(decodeMText('90\\U+00B0')).toBe('90°');
  });

  it('\\U+2205 → 공집합(∅) 기호 (도면 지름 표기에 흔히 쓰임)', () => {
    expect(decodeMText('\\U+2205100')).toBe('∅100');
  });

  it('잘못된 형식은 제어열로 취급되지 않고 살아남지 않음 — U는 미인자 문자로 리터럴화', () => {
    // \U+XYZ 는 4자리 hex가 아니므로 unicode 이스케이프 실패 → 백슬래시만 제거, 'U'는 리터럴
    expect(decodeMText('\\U+XY')).toBe('U+XY');
  });
});

describe('decodeMText — 비단절 공백·토글 제어열', () => {
  it('\\~ → 비단절 공백(U+00A0)', () => {
    expect(decodeMText('A\\~B')).toBe('A B');
  });

  it('밑줄/취소선 토글 \\L \\l \\O \\o \\K \\k 제거', () => {
    expect(decodeMText('\\L밑줄\\l\\O윗줄\\o\\K취소\\k')).toBe('밑줄윗줄취소');
  });

  it('폭/기울기/추적/정렬 인자형 제어열 제거', () => {
    expect(decodeMText('\\W0.8;\\Q15;\\T2;\\A1;텍스트')).toBe('텍스트');
  });
});

describe('decodeMText — 잘린 인자형 제어열 (세미콜론 없음, 본문 보존)', () => {
  it('\\C255 뒤 텍스트를 통째로 잃지 않는다 (문자열 끝까지 삼키지 않음)', () => {
    // 세미콜론 없이 잘린 색 코드 — 인자(255)만 버리고 보이는 텍스트는 남긴다
    expect(decodeMText('\\C255 rest text')).toBe(' rest text');
  });

  it('세미콜론 없는 인자 뒤 역슬래시 경계에서 멈춘다', () => {
    // \H1.15 뒤 세미콜론 없이 \P → 인자는 \ 경계까지, 그다음 \P는 줄바꿈
    expect(decodeMText('\\H1.15\\Pnext')).toBe('\nnext');
  });

  it('세미콜론 없는 인자 뒤 중괄호 경계에서 멈춘다', () => {
    expect(decodeMText('{\\C1 텍스트}')).toBe(' 텍스트');
  });
});

describe('decodeMText — \\S 분수 본문 이스케이프·빈 분자', () => {
  it('분수 본문의 \\P가 raw로 새지 않고 제거된다', () => {
    expect(decodeMText('\\Sa\\Pb^c;')).toBe('ab/c');
  });

  it('빈 분자 → 선행 슬래시 아티팩트 없이 분모만', () => {
    expect(decodeMText('\\S ^25;')).toBe('25');
  });

  it('분수 본문의 이스케이프된 리터럴 \\\\ 은 보존', () => {
    expect(decodeMText('\\Sa\\\\b^c;')).toBe('a\\b/c');
  });
});

describe('decodeMText — 미처리 제어열 누출 방지', () => {
  it('\\N(단 나눔)은 줄바꿈으로 — N이 텍스트에 섞이지 않음', () => {
    expect(decodeMText('left\\Nright')).toBe('left\nright');
  });

  it('알 수 없는 인자형 코드 \\Z9; 는 인자까지 완전 제거', () => {
    expect(decodeMText('\\Z9;keep')).toBe('keep');
  });

  it('알 수 없는 무인자 코드 \\X 는 문자까지 버린다 (리터럴 누출 없음)', () => {
    expect(decodeMText('a\\Xb')).toBe('ab');
  });
});

describe('decodeMText — 멱등(순수 텍스트 무변경)', () => {
  it('제어열 없는 문자열은 그대로', () => {
    const s = '단순 텍스트 123 abc';
    expect(decodeMText(s)).toBe(s);
  });

  it('디코딩 결과를 재디코딩해도 불변 (멱등)', () => {
    const raw = '{\\C4;1. 본 도면\\P2. 다음 \\S1^2; 참조}';
    const once = decodeMText(raw);
    expect(decodeMText(once)).toBe(once);
  });

  it('빈 문자열', () => {
    expect(decodeMText('')).toBe('');
  });
});
