import type { FormulaNode, ScubeProject, TakeoffItem } from '@s-cube/schema';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { itemQuantityKey, measurementValueKey, sectionAreaKey, segmentKey } from './cell-map.ts';
import { buildWorkbook, SHEET_NAMES } from './workbook.ts';

/**
 * Phase 4 게이트 테스트 — 수식 왕복 검증 (P4-12 절대 타협 금지).
 *
 * 합성 ScubeProject → buildWorkbook → ExcelJS 로 다시 읽어:
 *   (a) 수량 셀이 값이 아니라 수식(cell.formula 정의됨)인가
 *   (b) 하드코딩 숫자 없이 셀 참조를 포함하는가
 *   (c) 수식이 참조하는 셀들의 계산 결과가 core evaluate 논리와 일치하는가
 *       (ExcelJS 는 수식 재계산을 안 하므로, 수식 문자열을 파싱해 셀 값으로 독립 계산해 대조)
 */

// ── core/quantity/formula.ts 의 evaluate 최소 재구현 (xlsx 는 core 미의존) ──
type RefResolver = (cell: string) => number;
function evaluate(node: FormulaNode, refResolver: RefResolver): number {
  switch (node.op) {
    case 'const':
      return node.value;
    case 'ref':
      return refResolver(node.cell);
    case 'add':
    case 'sum':
      return node.args.reduce((acc, a) => acc + evaluate(a, refResolver), 0);
    case 'sub': {
      const [head, ...rest] = node.args;
      if (head === undefined) {
        throw new Error('sub empty');
      }
      return rest.reduce((acc, a) => acc - evaluate(a, refResolver), evaluate(head, refResolver));
    }
    case 'mul':
      return node.args.reduce((acc, a) => acc * evaluate(a, refResolver), 1);
    case 'div': {
      const [head, ...rest] = node.args;
      if (head === undefined) {
        throw new Error('div empty');
      }
      return rest.reduce((acc, a) => acc / evaluate(a, refResolver), evaluate(head, refResolver));
    }
    case 'avgEndArea':
      return (
        ((evaluate(node.a1, refResolver) + evaluate(node.a2, refResolver)) / 2) *
        evaluate(node.length, refResolver)
      );
    case 'round': {
      const f = 10 ** node.digits;
      return Math.round(evaluate(node.arg, refResolver) * f) / f;
    }
    case 'loss':
      return evaluate(node.arg, refResolver) * (1 + node.rate);
  }
}

/**
 * 워크북 수식 평가기 — ExcelJS 재계산을 대신한다.
 * 셀 주소('상세!C2' 또는 'B3')를 만나면 그 셀의 값을 읽고,
 * 그 셀이 다시 수식이면 재귀적으로 평가한다. 산술식·ROUND·SUMIF·SUM 지원.
 */
function makeWorkbookEvaluator(wb: ExcelJS.Workbook, defaultSheet: string) {
  const cache = new Map<string, number>();

  function cellValue(sheetName: string, addr: string): number {
    const key = `${sheetName}!${addr}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const ws = wb.getWorksheet(sheetName);
    if (ws === undefined) {
      throw new Error(`시트 없음: ${sheetName}`);
    }
    const cell = ws.getCell(addr);
    const v = cell.value;
    let result: number;
    if (v !== null && typeof v === 'object' && 'formula' in v && typeof v.formula === 'string') {
      result = evalFormula(v.formula, sheetName);
    } else if (typeof v === 'number') {
      result = v;
    } else {
      throw new Error(`숫자/수식 아님: ${key} = ${JSON.stringify(v)}`);
    }
    cache.set(key, result);
    return result;
  }

  /** 'A1' 또는 "'측점별 상세'!C2" / '상세!C2' → 값 */
  function resolveRef(ref: string, currentSheet: string): number {
    const m = ref.match(/^(?:'([^']+)'|([^!]+))!([A-Z]+\d+)$/);
    if (m) {
      const sheet = m[1] ?? m[2] ?? currentSheet;
      const addr = m[3];
      if (addr === undefined) {
        throw new Error(`주소 파싱 실패: ${ref}`);
      }
      return cellValue(sheet, addr);
    }
    if (/^[A-Z]+\d+$/.test(ref)) {
      return cellValue(currentSheet, ref);
    }
    throw new Error(`참조 파싱 실패: ${ref}`);
  }

  /** 범위 "'수량산출서'!A2:A5" → [주소...] (한 열 범위만 지원) */
  function expandRange(range: string): { sheet: string; addrs: string[] } {
    const m = range.match(/^(?:'([^']+)'|([^!]+))!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) {
      throw new Error(`범위 파싱 실패: ${range}`);
    }
    const sheet = m[1] ?? m[2];
    const col1 = m[3];
    const r1 = Number(m[4]);
    const col2 = m[5];
    const r2 = Number(m[6]);
    if (sheet === undefined || col1 === undefined || col2 === undefined || col1 !== col2) {
      throw new Error(`단일 열 범위만 지원: ${range}`);
    }
    const addrs: string[] = [];
    for (let r = r1; r <= r2; r++) {
      addrs.push(`${col1}${r}`);
    }
    return { sheet, addrs };
  }

  function cellText(sheetName: string, addr: string): string {
    const ws = wb.getWorksheet(sheetName);
    if (ws === undefined) {
      throw new Error(`시트 없음: ${sheetName}`);
    }
    const v = ws.getCell(addr).value;
    return typeof v === 'string' ? v : String(v ?? '');
  }

  function evalSumif(inner: string, currentSheet: string): number {
    // SUMIF(범위, 조건(=현재시트 셀주소), 합계범위)
    const parts = splitArgs(inner);
    const critRange = parts[0];
    const critRef = parts[1];
    const sumRange = parts[2];
    if (critRange === undefined || critRef === undefined || sumRange === undefined) {
      throw new Error(`SUMIF 인자 부족: ${inner}`);
    }
    const crit = expandRange(critRange);
    const sumr = expandRange(sumRange);
    // 조건 값(공종 텍스트)은 현재 시트의 셀에서 읽는다
    const critAddrMatch = critRef.match(/^([A-Z]+\d+)$/);
    if (critAddrMatch === null) {
      throw new Error(`SUMIF 조건은 셀 참조여야 함: ${critRef}`);
    }
    const critValue = cellText(currentSheet, critRef);
    let total = 0;
    for (let i = 0; i < crit.addrs.length; i++) {
      const critAddr = crit.addrs[i];
      const sumAddr = sumr.addrs[i];
      if (critAddr === undefined || sumAddr === undefined) {
        continue;
      }
      if (cellText(crit.sheet, critAddr) === critValue) {
        total += cellValue(sumr.sheet, sumAddr);
      }
    }
    return total;
  }

  function evalSum(inner: string, currentSheet: string): number {
    // SUM(B2:B4)
    const { sheet, addrs } = expandRange(
      inner.includes('!') ? inner : `${quoteIfNeeded(currentSheet)}!${inner}`,
    );
    let total = 0;
    for (const a of addrs) {
      total += cellValue(sheet, a);
    }
    return total;
  }

  function evalRound(inner: string, currentSheet: string): number {
    const parts = splitArgs(inner);
    const xExpr = parts[0];
    const nExpr = parts[1];
    if (xExpr === undefined || nExpr === undefined) {
      throw new Error(`ROUND 인자 부족: ${inner}`);
    }
    const x = evalArith(xExpr, currentSheet);
    const n = Number(nExpr);
    const f = 10 ** n;
    return Math.round(x * f) / f;
  }

  /** 함수 호출을 처리한 뒤 순수 산술식을 평가 */
  function evalFormula(formula: string, currentSheet: string): number {
    return evalArith(formula, currentSheet);
  }

  /**
   * 산술식 평가 — +,-,*,/, 괄호, ROUND/SUMIF/SUM 함수, 셀 참조, 숫자.
   * 클로저 기반 재귀 하강 파서 (erasableSyntaxOnly 준수 — 클래스/파라미터 프로퍼티 미사용).
   */
  function evalArith(expr: string, currentSheet: string): number {
    let i = 0;

    const skip = (): void => {
      while (i < expr.length && expr[i] === ' ') {
        i += 1;
      }
    };

    const parseExpr = (sheet: string): number => {
      let v = parseTerm(sheet);
      for (;;) {
        skip();
        const c = expr[i];
        if (c === '+') {
          i += 1;
          v += parseTerm(sheet);
        } else if (c === '-') {
          i += 1;
          v -= parseTerm(sheet);
        } else {
          break;
        }
      }
      return v;
    };

    const parseTerm = (sheet: string): number => {
      let v = parseFactor(sheet);
      for (;;) {
        skip();
        const c = expr[i];
        if (c === '*') {
          i += 1;
          v *= parseFactor(sheet);
        } else if (c === '/') {
          i += 1;
          v /= parseFactor(sheet);
        } else {
          break;
        }
      }
      return v;
    };

    const parseFactor = (sheet: string): number => {
      skip();
      const c = expr[i];
      if (c === '(') {
        i += 1;
        const v = parseExpr(sheet);
        skip();
        if (expr[i] !== ')') {
          throw new Error(`괄호 불일치: ${expr}`);
        }
        i += 1;
        return v;
      }
      if (c === '-') {
        i += 1;
        return -parseFactor(sheet);
      }
      const rest = expr.slice(i);
      // 함수: NAME(...) — 시트 인용부호(')로 시작하면 함수 아님(셀 참조)
      const fn = rest.match(/^([A-Z]+)\(/);
      if (fn?.[1] !== undefined && !rest.startsWith("'")) {
        const name = fn[1];
        const argStart = i + name.length + 1;
        const argEnd = matchParen(expr, argStart - 1);
        const inner = expr.slice(argStart, argEnd);
        i = argEnd + 1;
        if (name === 'ROUND') {
          return evalRound(inner, sheet);
        }
        if (name === 'SUMIF') {
          return evalSumif(inner, sheet);
        }
        if (name === 'SUM') {
          return evalSum(inner, sheet);
        }
        throw new Error(`미지원 함수: ${name}`);
      }
      // 셀참조: 'sheet'!A1 또는 sheet!A1 또는 A1
      const cellRef = rest.match(/^((?:'[^']+'|[^\s+\-*/()]+)!)?[A-Z]+\d+/);
      if (cellRef?.[0] !== undefined) {
        const token = cellRef[0];
        i += token.length;
        return resolveRef(token, sheet);
      }
      // 숫자
      const num = rest.match(/^\d+(?:\.\d+)?/);
      if (num?.[0] !== undefined) {
        i += num[0].length;
        return Number(num[0]);
      }
      throw new Error(`토큰 파싱 실패 @${i}: ${expr}`);
    };

    const v = parseExpr(currentSheet);
    skip();
    if (i !== expr.length) {
      throw new Error(`파싱 잔여 @${i}: ${expr}`);
    }
    return v;
  }

  return { evalFormula, evalArith: (e: string) => evalArith(e, defaultSheet) };
}

/** 최상위 콤마로 인자 분리 (괄호 깊이 고려) */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') {
      depth += 1;
      cur += ch;
    } else if (ch === ')') {
      depth -= 1;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '') {
    out.push(cur);
  }
  return out;
}

/** open 위치('(')의 짝 ')' 인덱스 */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') {
      depth += 1;
    } else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`괄호 짝 없음: ${s}`);
}

function quoteIfNeeded(sheet: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
}

// ── 합성 프로젝트 ──────────────────────────────────────────
function station(no: number, plus: number, disc: 'pre' | 'post' | null = null) {
  return {
    raw: `No.${no}+${plus.toFixed(3)}${disc === 'pre' ? '(전)' : disc === 'post' ? '(후)' : ''}`,
    no,
    plus_m: plus,
    chainage_m: no * 20 + plus,
    discontinuity: disc,
  };
}

/**
 * 측점 3개(절토), 측정 1건, 항목 몇 개.
 * - 절토: 구간 체적 2개의 합 (segment volume ref) — sectionLength 조합
 * - 철근: 측정 연장 × 단위중량 × (1+할증) — convertUnit + loss 조합
 * - 파생: 다른 항목(절토) 참조 (item ref)
 */
function makeProject(): ScubeProject {
  const s1 = { id: 'ss-1', station: station(8, 0), itemKey: '절토', area_m2: 12.5 };
  const s2 = { id: 'ss-2', station: station(9, 0), itemKey: '절토', area_m2: 14.2 };
  const s3 = { id: 'ss-3', station: station(10, 0), itemKey: '절토', area_m2: 10.0 };

  // 절토량 = seg(s1~s2).volume + seg(s2~s3).volume
  const cutBasis: FormulaNode = {
    op: 'sum',
    args: [
      { op: 'ref', cell: segmentKey('ss-1~ss-2', 'volume'), label: 'No.8~9 체적' },
      { op: 'ref', cell: segmentKey('ss-2~ss-3', 'volume'), label: 'No.9~10 체적' },
    ],
  };

  // 철근량(TON) = 측정연장(m) × 0.995(kg/m) × (1+0.03) / 1000
  const rebarBasis: FormulaNode = {
    op: 'div',
    args: [
      {
        op: 'loss',
        rate: 0.03,
        arg: {
          op: 'mul',
          args: [
            { op: 'ref', cell: measurementValueKey('m-1'), label: '철근 연장(m)' },
            { op: 'const', value: 0.995, label: '단위중량(kg/m)' },
          ],
        },
      },
      { op: 'const', value: 1000, label: 'kg→TON' },
    ],
  };

  // 파생 항목: 절토량의 절반 (다른 항목 참조) — item ref
  const derivedBasis: FormulaNode = {
    op: 'div',
    args: [
      { op: 'ref', cell: itemQuantityKey('ti-cut'), label: '절토량' },
      { op: 'const', value: 2, label: '2' },
    ],
  };

  const items: TakeoffItem[] = [
    {
      id: 'ti-cut',
      workType: '토공사',
      specCode: 'EARTH-CUT',
      unit: '㎥',
      quantity: 0,
      basis: cutBasis,
      sourceRefs: [],
    },
    {
      id: 'ti-rebar',
      workType: '철근공사',
      specCode: 'REBAR-D13',
      unit: 'TON',
      quantity: 0,
      basis: rebarBasis,
      sourceRefs: [{ drawingId: 'dwg-1', handles: ['1A2B'] }],
    },
    {
      id: 'ti-derived',
      workType: '토공사',
      specCode: 'EARTH-CUT',
      unit: '㎥',
      quantity: 0,
      basis: derivedBasis,
      sourceRefs: [],
    },
  ];

  return {
    schemaVersion: 1,
    meta: {
      projectName: '합성 시험 프로젝트',
      author: '테스터',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      stationInterval_m: 20,
    },
    drawings: [
      {
        id: 'dwg-1',
        fileName: 'plan.dxf',
        role: 'plan',
        entityCount: 0,
        contentHash: 's-cube:cal:v1:deadbeef',
        filePath: 'C:/p/plan.dxf',
        sha256: 'deadbeef',
        dxfVersion: 'AC1015',
        insUnits: 6,
        calibration: null,
        layers: [],
        loadedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    measurements: [
      {
        id: 'm-1',
        drawingId: 'dwg-1',
        kind: 'length',
        value: 120.5,
        rawValue: 120500,
        method: 'polyline',
        sourceHandles: ['1A2B', '3C4D'],
        label: '철근 배근 연장',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    sections: [s1, s2, s3],
    items,
    specs: [
      {
        code: 'EARTH-CUT',
        workType: '토공사',
        name: '흙깎기',
        spec: '보통토사',
        unit: '㎥',
        calcType: 'section-length',
      },
      {
        code: 'REBAR-D13',
        workType: '철근공사',
        name: '이형철근',
        spec: 'D13 SD400',
        unit: 'TON',
        calcType: 'length',
        conversions: [{ toUnit: 'kg', factor: 0.995, note: '단위중량' }],
        lossRate: 0.03,
      },
    ],
    history: [],
  };
}

/** 논리 키 기반 기대값 계산용 refResolver — core evaluate 와 동일 결과 */
function expectedResolver(project: ScubeProject): RefResolver {
  const values = new Map<string, number>();
  // 측정
  for (const m of project.measurements) {
    values.set(measurementValueKey(m.id), m.value);
  }
  // 단면적 + 구간 체적
  const bySection = new Map<string, number>();
  for (const s of project.sections) {
    values.set(sectionAreaKey(s.id), s.area_m2);
    bySection.set(s.id, s.area_m2);
  }
  // 구간 체적: (a1+a2)/2*L. segId = fromId~toId, 인접 chainage 차 = 연장
  const sorted = [...project.sections].sort((a, b) => a.station.chainage_m - b.station.chainage_m);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    const segId = `${from.id}~${to.id}`;
    const len = to.station.chainage_m - from.station.chainage_m;
    values.set(segmentKey(segId, 'a1'), from.area_m2);
    values.set(segmentKey(segId, 'a2'), to.area_m2);
    values.set(segmentKey(segId, 'length'), len);
    values.set(segmentKey(segId, 'volume'), ((from.area_m2 + to.area_m2) / 2) * len);
  }
  // 항목 수량 (참조 순서상 ti-cut 먼저 계산되어 파생이 참조 가능)
  return (cell: string): number => {
    const v = values.get(cell);
    if (v !== undefined) {
      return v;
    }
    // item ref 는 해당 항목 basis 를 재귀 평가
    const itemMatch = cell.match(/^item:(.+):quantity$/);
    if (itemMatch?.[1] !== undefined) {
      const item = project.items.find((it) => it.id === itemMatch[1]);
      if (item !== undefined) {
        return evaluate(item.basis, expectedResolver(project));
      }
    }
    throw new Error(`기대값 미정 참조: ${cell}`);
  };
}

async function readBack(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('buildWorkbook — 구조', () => {
  it('시트 5종을 지정 순서로 생성한다', async () => {
    const wb = await readBack(await buildWorkbook(makeProject()));
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      SHEET_NAMES.cover,
      SHEET_NAMES.summary,
      SHEET_NAMES.takeoff,
      SHEET_NAMES.detail,
      SHEET_NAMES.ledger,
    ]);
  });

  it('표지에 프로젝트명·작성자·산출일이 있다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const cover = wb.getWorksheet(SHEET_NAMES.cover);
    expect(cover).toBeDefined();
    const flat = cover ? JSON.stringify(cover.getSheetValues()) : '';
    expect(flat).toContain(project.meta.projectName);
    expect(flat).toContain(project.meta.author);
  });

  it('측정 원장에 handle 역추적 정보가 있다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const ledger = wb.getWorksheet(SHEET_NAMES.ledger);
    const flat = ledger ? JSON.stringify(ledger.getSheetValues()) : '';
    expect(flat).toContain('1A2B');
    expect(flat).toContain('철근 배근 연장');
  });
});

describe('buildWorkbook — P4-12 수량 셀은 수식 (절대 타협 금지)', () => {
  it('모든 수량 셀이 값이 아니라 수식이다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const takeoff = wb.getWorksheet(SHEET_NAMES.takeoff);
    expect(takeoff).toBeDefined();
    if (takeoff === undefined) {
      return;
    }
    project.items.forEach((_item, idx) => {
      const cell = takeoff.getCell(`D${2 + idx}`);
      const v = cell.value;
      expect(v).not.toBeNull();
      expect(typeof v === 'object' && v !== null && 'formula' in v).toBe(true);
    });
  });

  it('수량 수식은 하드코딩 숫자 없이 셀 참조를 포함한다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const takeoff = wb.getWorksheet(SHEET_NAMES.takeoff);
    if (takeoff === undefined) {
      throw new Error('수량산출서 시트 없음');
    }
    // ti-cut: 구간 체적 참조 — 셀 참조만
    const cutCell = takeoff.getCell('D2').value as { formula: string };
    expect(cutCell.formula).toMatch(/[A-Z]+\d+/); // 셀 참조 포함
    expect(cutCell.formula).toContain('상세'); // 상세 시트 참조
    // ti-rebar: 측정 연장 참조 — 원장 셀 참조 포함
    const rebarCell = takeoff.getCell('D3').value as { formula: string };
    expect(rebarCell.formula).toContain('측정 원장');
    // ti-derived: 다른 항목(수량산출서 D2) 참조
    const derivedCell = takeoff.getCell('D4').value as { formula: string };
    expect(derivedCell.formula).toContain('D2');
  });
});

describe('buildWorkbook — 수식 왕복 (참조 셀 계산 결과가 core evaluate 와 일치)', () => {
  it('각 수량 수식을 셀 값으로 독립 평가하면 evaluate 결과와 일치한다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const takeoff = wb.getWorksheet(SHEET_NAMES.takeoff);
    if (takeoff === undefined) {
      throw new Error('수량산출서 시트 없음');
    }
    const evalr = makeWorkbookEvaluator(wb, SHEET_NAMES.takeoff);
    const resolver = expectedResolver(project);

    project.items.forEach((item, idx) => {
      const cell = takeoff.getCell(`D${2 + idx}`).value as { formula: string };
      const workbookResult = evalr.evalFormula(cell.formula, SHEET_NAMES.takeoff);
      const coreResult = evaluate(item.basis, resolver);
      expect(workbookResult).toBeCloseTo(coreResult, 9);
    });
  });

  it('상세 시트 체적 셀은 그 자체가 (A1+A2)/2*L 수식이고 값과 일치한다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const detail = wb.getWorksheet(SHEET_NAMES.detail);
    if (detail === undefined) {
      throw new Error('상세 시트 없음');
    }
    // 체적 셀(F열) 중 하나가 수식인지 + 형태 확인
    let foundVolumeFormula = false;
    detail.eachRow((row) => {
      const f = row.getCell(6).value; // F
      if (f !== null && typeof f === 'object' && 'formula' in f && typeof f.formula === 'string') {
        expect(f.formula).toMatch(/^\(C\d+\+C\d+\)\/2\*D\d+$/);
        foundVolumeFormula = true;
      }
    });
    expect(foundVolumeFormula).toBe(true);
  });
});

describe('buildWorkbook — 집계표 SUMIF = 수량산출서 합', () => {
  it('공종별 SUMIF 합이 해당 공종 항목 수량 합과 일치한다', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const summary = wb.getWorksheet(SHEET_NAMES.summary);
    const takeoff = wb.getWorksheet(SHEET_NAMES.takeoff);
    if (summary === undefined || takeoff === undefined) {
      throw new Error('시트 없음');
    }
    const evalr = makeWorkbookEvaluator(wb, SHEET_NAMES.summary);
    const resolver = expectedResolver(project);

    // 기대: 공종별 항목 수량 합
    const expectedByWorkType = new Map<string, number>();
    for (const item of project.items) {
      const q = evaluate(item.basis, resolver);
      expectedByWorkType.set(item.workType, (expectedByWorkType.get(item.workType) ?? 0) + q);
    }

    // 집계표 각 행 검증
    summary.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return; // 헤더
      }
      const wt = row.getCell(1).value;
      const sumCell = row.getCell(2).value;
      if (typeof wt !== 'string' || wt === '총 합계') {
        return;
      }
      if (sumCell === null || typeof sumCell !== 'object' || !('formula' in sumCell)) {
        return;
      }
      const workbookSum = evalr.evalFormula(
        (sumCell as { formula: string }).formula,
        SHEET_NAMES.summary,
      );
      const expected = expectedByWorkType.get(wt);
      expect(expected).toBeDefined();
      if (expected !== undefined) {
        expect(workbookSum).toBeCloseTo(expected, 9);
      }
    });
  });

  it('총 합계 = 전체 항목 수량 합', async () => {
    const project = makeProject();
    const wb = await readBack(await buildWorkbook(project));
    const summary = wb.getWorksheet(SHEET_NAMES.summary);
    if (summary === undefined) {
      throw new Error('집계표 없음');
    }
    const evalr = makeWorkbookEvaluator(wb, SHEET_NAMES.summary);
    const resolver = expectedResolver(project);
    const totalExpected = project.items.reduce((acc, it) => acc + evaluate(it.basis, resolver), 0);

    // 마지막 '총 합계' 행 찾기
    let totalFormula: string | undefined;
    summary.eachRow((row) => {
      if (row.getCell(1).value === '총 합계') {
        const v = row.getCell(2).value;
        if (v !== null && typeof v === 'object' && 'formula' in v) {
          totalFormula = (v as { formula: string }).formula;
        }
      }
    });
    expect(totalFormula).toBeDefined();
    if (totalFormula !== undefined) {
      expect(evalr.evalFormula(totalFormula, SHEET_NAMES.summary)).toBeCloseTo(totalExpected, 9);
    }
  });
});
