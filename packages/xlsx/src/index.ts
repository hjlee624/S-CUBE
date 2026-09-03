/**
 * @s-cube/xlsx — 수량산출서 xlsx 생성 (Phase 4-C).
 *
 * FormulaNode 트리를 엑셀 셀 수식 문자열로 렌더하여 수량 셀에 삽입한다.
 * 하드코딩 숫자 금지 — 참조 가능한 값은 반드시 셀 참조로 (P4-12).
 * 감리가 셀을 클릭했을 때 =(상세!D12+상세!D13)/2*상세!E12 형태 계산식이 보인다.
 */

export {
  CellMap,
  columnLetter,
  itemGeometryKey,
  itemQuantityKey,
  measurementValueKey,
  sectionAreaKey,
  segmentKey,
  sheetRef,
} from './cell-map.ts';
export { type CellResolver, renderExcelFormula } from './formula-excel.ts';
export { buildWorkbook, SHEET_NAMES } from './workbook.ts';
