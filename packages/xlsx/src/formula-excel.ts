import type { FormulaNode } from '@s-cube/schema';

/**
 * FormulaNode → 엑셀 셀 수식 문자열 렌더 (P4-12, 이 프로젝트의 차별점).
 *
 * 감리가 셀을 클릭했을 때 `=(상세!D12+상세!D13)/2*상세!E12` 형태의 계산식이
 * 보여야 한다. 참조 가능한 상세값은 하드코딩 숫자가 아니라 반드시 셀 참조로 나온다.
 * 이 함수는 트리를 충실히 렌더하고, ref 노드의 셀 주소는 cellOf 로 해석한다
 * (상위 항목 조립부에서 참조 가능한 값이 ref 로 오도록 보장한다).
 *
 * 내부 계산은 반올림하지 않는다 (21-CONVENTIONS §4). round 노드가 명시된 경우만
 * ROUND() 로 렌더하고, 표시 자리수는 셀 numFmt 로 처리한다.
 */

/** ref.cell(논리 키) → 실제 엑셀 셀 주소(시트 수식화 완료) 해석기 */
export type CellResolver = (ref: string) => string;

/**
 * 연산자 우선순위: 합·차(1) < 곱·나눗셈(2) < 원자(3).
 * core/quantity/formula.ts 의 renderText 와 동일 규칙 — 텍스트/엑셀 렌더 일관성 유지.
 */
function precedence(node: FormulaNode): number {
  switch (node.op) {
    case 'add':
    case 'sub':
    case 'sum':
      return 1;
    case 'mul':
    case 'div':
    case 'loss':
    case 'avgEndArea':
      return 2;
    default:
      return 3;
  }
}

/**
 * 숫자 리터럴 렌더 — 반올림 없이 그대로. 지수 표기(1e-7)는 엑셀이 수식으로 못 읽으므로
 * 고정 소수 표기로 확장한다.
 */
function renderConst(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`엑셀 수식에 유한하지 않은 상수를 넣을 수 없습니다: ${value}`);
  }
  const s = String(value);
  if (!s.includes('e') && !s.includes('E')) {
    return s;
  }
  // 지수 표기 → 고정 표기. 유효 자리 보존을 위해 넉넉히.
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 인자 나열 렌더. strictRight: 뺄셈·나눗셈처럼 우측 동순위 인자에 괄호가 필요한 연산.
 * 예: a-(b+c), a/(b*c). 음수 리터럴이 뒤따르면(예: a*-3) 괄호로 감싼다.
 */
function renderChain(
  args: FormulaNode[],
  symbol: string,
  prec: number,
  strictRight: boolean,
  cellOf: CellResolver,
): string {
  return args
    .map((arg, i) => {
      const text = render(arg, cellOf);
      const p = precedence(arg);
      const needsParen =
        p < prec || (i > 0 && strictRight && p === prec) || (i > 0 && text.startsWith('-'));
      return needsParen ? `(${text})` : text;
    })
    .join(symbol);
}

/** 하위 노드를 우선순위 prec 미만이면 괄호로 감싸 렌더 */
function wrapBelow(node: FormulaNode, prec: number, cellOf: CellResolver): string {
  const text = render(node, cellOf);
  return precedence(node) < prec ? `(${text})` : text;
}

/** 재귀 렌더 — 최상위 '=' 접두는 renderExcelFormula 에서 1회만 붙인다 */
function render(node: FormulaNode, cellOf: CellResolver): string {
  switch (node.op) {
    case 'const':
      return renderConst(node.value);
    case 'ref':
      return cellOf(node.cell);
    case 'add':
    case 'sum':
      return renderChain(node.args, '+', 1, false, cellOf);
    case 'sub':
      return renderChain(node.args, '-', 1, true, cellOf);
    case 'mul':
      return renderChain(node.args, '*', 2, false, cellOf);
    case 'div':
      return renderChain(node.args, '/', 2, true, cellOf);
    case 'avgEndArea': {
      // (a1 + a2) / 2 * length
      const a1 = render(node.a1, cellOf);
      const a2 = render(node.a2, cellOf);
      const len = wrapBelow(node.length, 2, cellOf);
      return `(${a1}+${a2})/2*${len}`;
    }
    case 'round':
      return `ROUND(${render(node.arg, cellOf)},${node.digits})`;
    case 'loss':
      // arg * (1 + rate) — 할증. rate 는 규격 상수라 리터럴로 유지한다.
      return `${wrapBelow(node.arg, 2, cellOf)}*(1+${renderConst(node.rate)})`;
  }
}

/**
 * FormulaNode 를 엑셀 셀 수식 문자열(선행 '=' 제외)로 렌더한다.
 *
 * ExcelJS 의 CellFormulaValue.formula 는 '=' 없이 수식 본문만 받으므로
 * 이 함수도 '=' 를 붙이지 않는다. 사람이 읽는 표기가 필요하면 '=' 를 앞에 붙이면 된다.
 *
 * @param node   산출근거 트리
 * @param cellOf ref 노드의 논리 키 → 실제 엑셀 셀 주소 해석기
 */
export function renderExcelFormula(node: FormulaNode, cellOf: CellResolver): string {
  return render(node, cellOf);
}
