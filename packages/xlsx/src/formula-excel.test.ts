import type { FormulaNode } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { type CellResolver, renderExcelFormula } from './formula-excel.ts';

/** 논리 키를 대문자로 매핑하는 간단 해석기 — 셀 주소 자리 표시 */
const idOf: CellResolver = (ref) => ref;

/** section:X:area → 상세!X 로 매핑 (시트 참조 형태 확인용) */
const sheetOf: CellResolver = (ref) => `상세!${ref.replace(/[^A-Za-z0-9]/g, '')}`;

describe('renderExcelFormula — 각 연산자', () => {
  it('const 는 리터럴', () => {
    expect(renderExcelFormula({ op: 'const', value: 12.5 }, idOf)).toBe('12.5');
  });

  it('ref 는 cellOf 로 해석', () => {
    expect(renderExcelFormula({ op: 'ref', cell: 'D12', label: 'A1' }, (r) => `상세!${r}`)).toBe(
      '상세!D12',
    );
  });

  it('add', () => {
    const node: FormulaNode = {
      op: 'add',
      args: [
        { op: 'const', value: 1 },
        { op: 'const', value: 2 },
        { op: 'const', value: 3 },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('1+2+3');
  });

  it('sub 는 좌결합', () => {
    const node: FormulaNode = {
      op: 'sub',
      args: [
        { op: 'const', value: 10 },
        { op: 'const', value: 3 },
        { op: 'const', value: 2 },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('10-3-2');
  });

  it('mul (× 아니라 *)', () => {
    const node: FormulaNode = {
      op: 'mul',
      args: [
        { op: 'const', value: 4 },
        { op: 'const', value: 5 },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('4*5');
  });

  it('div 는 좌결합', () => {
    const node: FormulaNode = {
      op: 'div',
      args: [
        { op: 'const', value: 20 },
        { op: 'const', value: 4 },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('20/4');
  });

  it('sum 은 + 로 나열', () => {
    const node: FormulaNode = {
      op: 'sum',
      args: [
        { op: 'ref', cell: 'A', label: 'a' },
        { op: 'ref', cell: 'B', label: 'b' },
        { op: 'ref', cell: 'C', label: 'c' },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('A+B+C');
  });
});

describe('renderExcelFormula — 우선순위 괄호', () => {
  it('곱 안의 합은 괄호로 감싼다: (a+b)*c', () => {
    const node: FormulaNode = {
      op: 'mul',
      args: [
        {
          op: 'add',
          args: [
            { op: 'const', value: 1 },
            { op: 'const', value: 2 },
          ],
        },
        { op: 'const', value: 3 },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('(1+2)*3');
  });

  it('합 안의 곱은 괄호 불필요: a+b*c', () => {
    const node: FormulaNode = {
      op: 'add',
      args: [
        { op: 'const', value: 1 },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 2 },
            { op: 'const', value: 3 },
          ],
        },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('1+2*3');
  });

  it('뺄셈 우측 동순위는 괄호: a-(b+c)', () => {
    const node: FormulaNode = {
      op: 'sub',
      args: [
        { op: 'const', value: 10 },
        {
          op: 'add',
          args: [
            { op: 'const', value: 3 },
            { op: 'const', value: 2 },
          ],
        },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('10-(3+2)');
  });

  it('나눗셈 우측 동순위는 괄호: a/(b*c)', () => {
    const node: FormulaNode = {
      op: 'div',
      args: [
        { op: 'const', value: 20 },
        {
          op: 'mul',
          args: [
            { op: 'const', value: 2 },
            { op: 'const', value: 5 },
          ],
        },
      ],
    };
    expect(renderExcelFormula(node, idOf)).toBe('20/(2*5)');
  });
});

describe('renderExcelFormula — 복합 노드 형태', () => {
  it('avgEndArea → (a1+a2)/2*len', () => {
    const node: FormulaNode = {
      op: 'avgEndArea',
      a1: { op: 'ref', cell: 'D12', label: 'A1' },
      a2: { op: 'ref', cell: 'D13', label: 'A2' },
      length: { op: 'ref', cell: 'E12', label: 'L' },
    };
    expect(renderExcelFormula(node, (r) => `상세!${r}`)).toBe('(상세!D12+상세!D13)/2*상세!E12');
  });

  it('avgEndArea length 가 합이면 괄호: (a1+a2)/2*(x+y)', () => {
    const node: FormulaNode = {
      op: 'avgEndArea',
      a1: { op: 'const', value: 1 },
      a2: { op: 'const', value: 2 },
      length: {
        op: 'add',
        args: [
          { op: 'const', value: 3 },
          { op: 'const', value: 4 },
        ],
      },
    };
    expect(renderExcelFormula(node, idOf)).toBe('(1+2)/2*(3+4)');
  });

  it('round → ROUND(x,n)', () => {
    const node: FormulaNode = {
      op: 'round',
      arg: { op: 'ref', cell: 'D12', label: 'q' },
      digits: 2,
    };
    expect(renderExcelFormula(node, (r) => r)).toBe('ROUND(D12,2)');
  });

  it('loss → x*(1+rate)', () => {
    const node: FormulaNode = {
      op: 'loss',
      arg: { op: 'ref', cell: 'D12', label: 'q' },
      rate: 0.03,
    };
    expect(renderExcelFormula(node, (r) => r)).toBe('D12*(1+0.03)');
  });

  it('loss 안의 합은 괄호: (a+b)*(1+rate)', () => {
    const node: FormulaNode = {
      op: 'loss',
      arg: {
        op: 'add',
        args: [
          { op: 'const', value: 1 },
          { op: 'const', value: 2 },
        ],
      },
      rate: 0.05,
    };
    expect(renderExcelFormula(node, idOf)).toBe('(1+2)*(1+0.05)');
  });

  it('중첩: round(loss(avgEndArea))', () => {
    const node: FormulaNode = {
      op: 'round',
      digits: 2,
      arg: {
        op: 'loss',
        rate: 0.03,
        arg: {
          op: 'avgEndArea',
          a1: { op: 'ref', cell: 'A1', label: 'A1' },
          a2: { op: 'ref', cell: 'A2', label: 'A2' },
          length: { op: 'ref', cell: 'L', label: 'L' },
        },
      },
    };
    expect(renderExcelFormula(node, sheetOf)).toBe('ROUND((상세!A1+상세!A2)/2*상세!L*(1+0.03),2)');
  });

  it('convertUnit 형태: (측정셀)*단위중량', () => {
    // area-thickness 나 length×unitWeight 같은 mul 조합
    const node: FormulaNode = {
      op: 'mul',
      args: [
        { op: 'ref', cell: 'val', label: '연장' },
        { op: 'const', value: 0.995, label: '단위중량' },
      ],
    };
    expect(renderExcelFormula(node, (r) => `원장!${r}`)).toBe('원장!val*0.995');
  });
});

describe('renderExcelFormula — 리터럴 방어', () => {
  it('지수 표기 상수를 고정 소수로 확장한다', () => {
    const node: FormulaNode = { op: 'const', value: 1e-7 };
    const out = renderExcelFormula(node, idOf);
    expect(out).not.toMatch(/e/i);
    expect(Number(out)).toBeCloseTo(1e-7, 12);
  });

  it('유한하지 않은 상수는 에러', () => {
    expect(() =>
      renderExcelFormula({ op: 'const', value: Number.POSITIVE_INFINITY }, idOf),
    ).toThrow();
  });
});
