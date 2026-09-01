import type { Borders, Style } from 'exceljs';

/**
 * 관급 문서 서식 상수 (P4-13).
 *
 * 숫자 자리수: 면적 4·연장 3·체적 2 (numFmt 표시 자리수). 저장값은 수식(원본 정밀) —
 * 반올림은 표시 서식에서만 한다 (21-CONVENTIONS §4). 단위 열은 우측정렬, 헤더는
 * 굵게·가운데·연회색 채움, 한글 폰트(맑은 고딕) 지정.
 */

/** 기본 한글 폰트 — 맑은 고딕 (관급 문서 관례) */
export const KOREAN_FONT = '맑은 고딕';

/** 숫자 표시 자리수 (numFmt) — 저장값은 수식(원본 정밀), 표시만 반올림 */
export const NUM_FMT = {
  /** 면적 ㎡ — 소수 4자리 */
  area: '#,##0.0000',
  /** 연장 m — 소수 3자리 */
  length: '#,##0.000',
  /** 체적 ㎥ — 소수 2자리 */
  volume: '#,##0.00',
  /** 수량 (발주 단위) — 소수 3자리 (품셈 관례) */
  quantity: '#,##0.000',
  /** 정수 개수 */
  count: '#,##0',
} as const;

/** 얇은 실선 사방 테두리 */
export const THIN_BORDER: Partial<Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

/** 헤더 셀 스타일 — 굵게·가운데·연회색 채움·테두리 */
export const HEADER_STYLE: Partial<Style> = {
  font: { name: KOREAN_FONT, bold: true, size: 10 },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' },
  },
  border: THIN_BORDER,
};

/** 본문 셀 기본 스타일 — 한글 폰트·테두리 */
export const BODY_STYLE: Partial<Style> = {
  font: { name: KOREAN_FONT, size: 10 },
  border: THIN_BORDER,
  alignment: { vertical: 'middle' },
};

/** 제목(표지 큰 글씨) 스타일 */
export const TITLE_STYLE: Partial<Style> = {
  font: { name: KOREAN_FONT, bold: true, size: 20 },
  alignment: { horizontal: 'center', vertical: 'middle' },
};

/** 라벨(표지 항목명) 스타일 — 우측 정렬 굵게 */
export const LABEL_STYLE: Partial<Style> = {
  font: { name: KOREAN_FONT, bold: true, size: 11 },
  alignment: { horizontal: 'right', vertical: 'middle' },
};

/** 값(표지 항목값) 스타일 — 좌측 정렬 */
export const VALUE_STYLE: Partial<Style> = {
  font: { name: KOREAN_FONT, size: 11 },
  alignment: { horizontal: 'left', vertical: 'middle' },
};
