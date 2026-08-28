import type { FormulaNode } from '@s-cube/schema';

/**
 * FormulaNode 빌더 + 순수 계산기(evaluate) + 산출근거 텍스트 렌더(renderText).
 *
 * 엑셀 수식 렌더(셀 주소 기반)는 Phase 4 — 여기서는 하지 않는다.
 * 내부 계산은 반올림하지 않는다 (21-CONVENTIONS §4) — round 노드가 명시된 경우만 예외.
 */

// ── 빌더 헬퍼 ──────────────────────────────────────────────

export function fConst(value: number, label?: string): FormulaNode {
  return label === undefined ? { op: 'const', value } : { op: 'const', value, label };
}

/** 다른 시트 셀 참조 — label 은 사람이 읽는 항목명 (renderText 에 사용) */
export function fRef(cell: string, label: string): FormulaNode {
  return { op: 'ref', cell, label };
}

export function fAdd(...args: FormulaNode[]): FormulaNode {
  return { op: 'add', args };
}

/** 좌결합 차감: fSub(a, b, c) = a − b − c */
export function fSub(...args: FormulaNode[]): FormulaNode {
  return { op: 'sub', args };
}

export function fMul(...args: FormulaNode[]): FormulaNode {
  return { op: 'mul', args };
}

/** 좌결합 나눗셈: fDiv(a, b) = a ÷ b */
export function fDiv(...args: FormulaNode[]): FormulaNode {
  return { op: 'div', args };
}

/** 양단면평균법: (a1 + a2) / 2 × length */
export function fAvgEndArea(a1: FormulaNode, a2: FormulaNode, length: FormulaNode): FormulaNode {
  return { op: 'avgEndArea', a1, a2, length };
}

export function fSum(args: FormulaNode[]): FormulaNode {
  return { op: 'sum', args };
}

/** 지정 자리수 반올림 — 표시·발주 수량 확정 시점에만 사용 */
export function fRound(arg: FormulaNode, digits: number): FormulaNode {
  return { op: 'round', arg, digits };
}

/** 할증: arg × (1 + rate) — rate 0.03 = 3% */
export function fLoss(arg: FormulaNode, rate: number): FormulaNode {
  return { op: 'loss', arg, rate };
}

// ── 순수 계산기 ────────────────────────────────────────────

export type RefResolver = (cell: string) => number;

function first(args: FormulaNode[], op: string): FormulaNode {
  const head = args[0];
  if (head === undefined) {
    throw new Error(`${op} 노드에는 인자가 1개 이상 필요합니다`);
  }
  return head;
}

/**
 * FormulaNode 트리를 숫자로 평가한다. 반올림 없음 (round 노드 제외).
 * ref 노드가 있으면 refResolver 가 필수 — 없으면 에러.
 */
export function evaluate(node: FormulaNode, refResolver?: RefResolver): number {
  switch (node.op) {
    case 'const':
      return node.value;
    case 'ref': {
      if (refResolver === undefined) {
        throw new Error(
          `ref 노드 평가에는 refResolver 가 필요합니다: ${node.cell} (${node.label})`,
        );
      }
      return refResolver(node.cell);
    }
    case 'add':
    case 'sum':
      return node.args.reduce((acc, a) => acc + evaluate(a, refResolver), 0);
    case 'sub': {
      const head = first(node.args, 'sub');
      return node.args
        .slice(1)
        .reduce((acc, a) => acc - evaluate(a, refResolver), evaluate(head, refResolver));
    }
    case 'mul':
      return node.args.reduce((acc, a) => acc * evaluate(a, refResolver), 1);
    case 'div': {
      const head = first(node.args, 'div');
      return node.args.slice(1).reduce(
        (acc, a) => {
          const d = evaluate(a, refResolver);
          if (d === 0) {
            throw new Error('div 노드: 0으로 나눌 수 없습니다');
          }
          return acc / d;
        },
        evaluate(head, refResolver),
      );
    }
    case 'avgEndArea':
      return (
        ((evaluate(node.a1, refResolver) + evaluate(node.a2, refResolver)) / 2) *
        evaluate(node.length, refResolver)
      );
    case 'round': {
      const factor = 10 ** node.digits;
      return Math.round(evaluate(node.arg, refResolver) * factor) / factor;
    }
    case 'loss':
      return evaluate(node.arg, refResolver) * (1 + node.rate);
  }
}

// ── 산출근거 텍스트 렌더 ───────────────────────────────────

/** 연산자 우선순위: 합·차(1) < 곱·나눗셈(2) < 원자(3) */
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

/** 숫자 → 텍스트 (반올림 없이 그대로) */
function formatNumber(value: number): string {
  return String(value);
}

/**
 * 인자 나열 렌더. strictRight: 뺄셈·나눗셈처럼 우측 동순위 인자에 괄호가 필요한 연산.
 * 예: a−(b+c), a÷(b×c)
 */
function renderChain(
  args: FormulaNode[],
  symbol: string,
  prec: number,
  strictRight: boolean,
): string {
  return args
    .map((a, i) => {
      const text = renderText(a);
      const p = precedence(a);
      const needsParen =
        p < prec || (i > 0 && strictRight && p === prec) || (i > 0 && text.startsWith('-'));
      return needsParen ? `(${text})` : text;
    })
    .join(symbol);
}

function wrapBelow(node: FormulaNode, prec: number): string {
  const text = renderText(node);
  return precedence(node) < prec ? `(${text})` : text;
}

/**
 * 사람이 읽는 산출근거 문자열. 예: "(12.5+14.2)/2×20"
 * ref 노드는 셀 주소 대신 label 을 렌더한다 (셀 주소 렌더는 Phase 4).
 */
export function renderText(node: FormulaNode): string {
  switch (node.op) {
    case 'const':
      return formatNumber(node.value);
    case 'ref':
      return node.label;
    case 'add':
    case 'sum':
      return renderChain(node.args, '+', 1, false);
    case 'sub':
      return renderChain(node.args, '-', 1, true);
    case 'mul':
      return renderChain(node.args, '×', 2, false);
    case 'div':
      return renderChain(node.args, '/', 2, true);
    case 'avgEndArea':
      return `(${renderText(node.a1)}+${renderText(node.a2)})/2×${wrapBelow(node.length, 2)}`;
    case 'round':
      return `ROUND(${renderText(node.arg)}, ${node.digits})`;
    case 'loss':
      return `${wrapBelow(node.arg, 2)}×${formatNumber(1 + node.rate)}`;
  }
}
