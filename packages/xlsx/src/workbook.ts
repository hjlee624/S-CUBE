import type { ScubeProject, StationSection, TakeoffItem } from '@s-cube/schema';
import ExcelJS from 'exceljs';
import {
  CellMap,
  itemQuantityKey,
  measurementValueKey,
  sectionAreaKey,
  segmentKey,
  sheetRef,
} from './cell-map.ts';
import {
  BODY_STYLE,
  HEADER_STYLE,
  KOREAN_FONT,
  LABEL_STYLE,
  NUM_FMT,
  TITLE_STYLE,
  VALUE_STYLE,
} from './format.ts';
import { renderExcelFormula } from './formula-excel.ts';

/**
 * 수량산출서 xlsx 빌더 (P4-11 ~ P4-13).
 *
 * 2-pass 셀 할당으로 P4-12 를 구현한다:
 *   1-pass 레이아웃 — 측점별 상세·측정 원장 시트에 각 값의 셀 주소를 부여하고 CellMap 에 등록.
 *                     구간 체적은 그 자리에서 =(A1+A2)/2*L 수식 셀로 배치한다.
 *   2-pass 수식 렌더 — 수량산출서의 각 TakeoffItem.quantity 셀에 renderExcelFormula(basis)
 *                     로 상세/측정 시트 셀을 참조하는 수식을 넣는다. 집계표는 SUMIF 로 참조.
 *
 * 수량 셀은 값이 아니라 수식이다 (P4-12, 절대 타협 금지).
 */

export const SHEET_NAMES = {
  cover: '표지',
  summary: '집계표',
  takeoff: '수량산출서',
  detail: '측점별 상세',
  ledger: '측정 원장',
} as const;

const DISCONTINUITY_RANK: Record<string, number> = { pre: 0, null: 1, post: 2 };

/** 단면 정렬 — chainage 오름차순, 동일 chainage 는 pre→null→post (buildSegments 규약과 동일) */
function sortSections(sections: StationSection[]): StationSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const dc = a.section.station.chainage_m - b.section.station.chainage_m;
      if (dc !== 0) {
        return dc;
      }
      const da = DISCONTINUITY_RANK[a.section.station.discontinuity ?? 'null'] ?? 1;
      const db = DISCONTINUITY_RANK[b.section.station.discontinuity ?? 'null'] ?? 1;
      if (da !== db) {
        return da - db;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.section);
}

/** 두 단면이 전/후 불연속 쌍(같은 chainage, pre→post)인지 — 연장 0 구간 */
function isDiscontinuityPair(a: StationSection, b: StationSection): boolean {
  return (
    a.station.chainage_m === b.station.chainage_m &&
    a.station.discontinuity === 'pre' &&
    b.station.discontinuity === 'post'
  );
}

/** 헤더 행 스타일 적용 */
function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.style = { ...HEADER_STYLE };
  });
  row.height = 22;
}

/** 본문 행 기본 스타일 적용 (테두리·폰트). 빈 셀 포함 */
function applyBodyStyle(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.style = { ...BODY_STYLE, ...cell.style };
  });
}

/** ── 1) 표지 시트 (P4-11) ─────────────────────────────── */
function buildCoverSheet(ws: ExcelJS.Worksheet, project: ScubeProject): void {
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 48;

  ws.mergeCells('A1:B1');
  const titleCell = ws.getCell('A1');
  titleCell.value = '수 량 산 출 서';
  titleCell.style = { ...TITLE_STYLE };
  ws.getRow(1).height = 40;

  const rows: [string, string][] = [
    ['프로젝트명', project.meta.projectName],
    ['도면번호', project.meta.drawingNo ?? '-'],
    ['산출일', project.meta.updatedAt],
    ['작성자', project.meta.author],
    ['검토자', project.meta.reviewer ?? '-'],
    ['측점간격(m)', String(project.meta.stationInterval_m)],
  ];

  let r = 3;
  for (const [label, value] of rows) {
    const labelCell = ws.getCell(`A${r}`);
    labelCell.value = label;
    labelCell.style = { ...LABEL_STYLE };
    const valueCell = ws.getCell(`B${r}`);
    valueCell.value = value;
    valueCell.style = { ...VALUE_STYLE };
    ws.getRow(r).height = 20;
    r += 1;
  }

  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
}

/**
 * ── 4) 측점별 상세 시트 (P4-11, 1-pass 레이아웃) ─────────
 *
 * 각 측점 단면적을 셀에 배치하고 CellMap 에 등록한다 (section:<id>:area).
 * 인접 단면 쌍마다 구간(연장·평균단면적·체적)을 전개하며, 체적 셀에는
 * =(A1+A2)/2*L 수식(같은 시트 셀 참조)을 넣는다 — 상세 시트 안에서도 참조가 살아 있다.
 */
function buildDetailSheet(ws: ExcelJS.Worksheet, project: ScubeProject, cells: CellMap): void {
  const headers = ['항목', '측점', '단면적(㎡)', '구간연장(m)', '평균단면적(㎡)', '체적(㎥)'];
  const widths = [14, 22, 14, 14, 16, 14];
  headers.forEach((_h, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? 12;
  });
  styleHeaderRow(ws.addRow(headers));

  // 컬럼: A항목 B측점 C단면적 D연장 E평균단면 F체적
  const COL_AREA = 'C';
  const COL_LEN = 'D';
  const COL_VOL = 'F';

  // itemKey 별로 묶어 정렬 후 전개.
  const byItem = new Map<string, StationSection[]>();
  for (const s of project.sections) {
    const bucket = byItem.get(s.itemKey);
    if (bucket === undefined) {
      byItem.set(s.itemKey, [s]);
    } else {
      bucket.push(s);
    }
  }

  let rowNum = 2; // 헤더 다음 행
  const areaAddrOf = new Map<string, string>(); // sectionId → 같은 시트 셀 주소

  for (const [itemKey, group] of byItem) {
    const sorted = sortSections(group);

    // 단면 행: 항목·측점·단면적. 단면적 셀을 CellMap 에 등록.
    for (const section of sorted) {
      const row = ws.addRow([itemKey, section.station.raw, section.area_m2, null, null, null]);
      applyBodyStyle(row);
      const areaAddr = `${COL_AREA}${rowNum}`;
      ws.getCell(areaAddr).numFmt = NUM_FMT.area;
      cells.set(sectionAreaKey(section.id), sheetRef(SHEET_NAMES.detail, areaAddr));
      areaAddrOf.set(section.id, areaAddr);
      rowNum += 1;
    }

    // 인접 쌍으로 구간 전개. 체적 = (A1+A2)/2*L 수식.
    for (let i = 0; i + 1 < sorted.length; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (from === undefined || to === undefined) {
        continue;
      }
      const a1Addr = areaAddrOf.get(from.id);
      const a2Addr = areaAddrOf.get(to.id);
      if (a1Addr === undefined || a2Addr === undefined) {
        continue;
      }
      const pair = isDiscontinuityPair(from, to);
      const length_m = pair ? 0 : to.station.chainage_m - from.station.chainage_m;
      const segId = `${from.id}~${to.id}`;
      const label = `${from.station.raw} ~ ${to.station.raw}`;

      const row = ws.addRow([`${itemKey} 구간`, label, null, length_m, null, null]);
      applyBodyStyle(row);
      const lenAddr = `${COL_LEN}${rowNum}`;
      ws.getCell(lenAddr).numFmt = NUM_FMT.length;

      // 평균단면적 = (A1+A2)/2 — 셀 참조 수식
      const avgAddr = `E${rowNum}`;
      ws.getCell(avgAddr).value = { formula: `(${a1Addr}+${a2Addr})/2` };
      ws.getCell(avgAddr).numFmt = NUM_FMT.area;

      // 체적 = (A1+A2)/2*L — 같은 시트 셀 참조 수식 (P4-12)
      const volAddr = `${COL_VOL}${rowNum}`;
      ws.getCell(volAddr).value = { formula: `(${a1Addr}+${a2Addr})/2*${lenAddr}` };
      ws.getCell(volAddr).numFmt = NUM_FMT.volume;

      // CellMap 등록: 구간 시·종점 단면적·연장·체적 (시트 수식화 주소)
      cells.set(segmentKey(segId, 'a1'), sheetRef(SHEET_NAMES.detail, a1Addr));
      cells.set(segmentKey(segId, 'a2'), sheetRef(SHEET_NAMES.detail, a2Addr));
      cells.set(segmentKey(segId, 'length'), sheetRef(SHEET_NAMES.detail, lenAddr));
      cells.set(segmentKey(segId, 'volume'), sheetRef(SHEET_NAMES.detail, volAddr));

      rowNum += 1;
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    printTitlesRow: '1:1',
  };
}

/**
 * ── 5) 측정 원장 시트 (P4-11, 1-pass 레이아웃) ───────────
 *
 * 각 측정값을 셀에 배치하고 CellMap 에 등록한다 (measurement:<id>:value).
 * 도면·방식·handle 을 함께 남겨 수량 → 측정 → 도면 엔티티 역추적을 보장한다.
 */
function buildLedgerSheet(ws: ExcelJS.Worksheet, project: ScubeProject, cells: CellMap): void {
  const headers = ['측정ID', '도면', '종류', '방식', 'handle', '라벨', '값'];
  const widths = [16, 22, 8, 12, 20, 18, 14];
  headers.forEach((_h, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? 12;
  });
  styleHeaderRow(ws.addRow(headers));

  const drawingName = new Map<string, string>();
  for (const d of project.drawings) {
    drawingName.set(d.id, d.fileName);
  }

  const COL_VALUE = 'G';
  let rowNum = 2;
  for (const m of project.measurements) {
    const row = ws.addRow([
      m.id,
      drawingName.get(m.drawingId) ?? m.drawingId,
      m.kind === 'area' ? '면적' : '연장',
      m.method,
      m.sourceHandles.join(', '),
      m.label,
      m.value,
    ]);
    applyBodyStyle(row);
    const valueAddr = `${COL_VALUE}${rowNum}`;
    ws.getCell(valueAddr).numFmt = m.kind === 'area' ? NUM_FMT.area : NUM_FMT.length;
    cells.set(measurementValueKey(m.id), sheetRef(SHEET_NAMES.ledger, valueAddr));
    rowNum += 1;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    printTitlesRow: '1:1',
  };
}

/** 수량산출서 시트 레이아웃 반환 (집계표 SUMIF 범위 계산용) */
interface TakeoffLayout {
  firstDataRow: number;
  lastDataRow: number;
  workTypeCol: string;
  qtyCol: string;
}

/**
 * ── 3) 수량산출서 시트 (P4-11, 2-pass 수식 렌더) ─────────
 *
 * 각 TakeoffItem 수량 셀에 renderExcelFormula(item.basis) 로 상세/측정 시트 셀을
 * 참조하는 수식을 넣는다 (P4-12). 항목 간 참조를 위해 각 항목 수량 셀 주소를
 * item:<id>:quantity 로 미리 등록한다 (2-pass 내 선등록).
 */
function buildTakeoffSheet(
  ws: ExcelJS.Worksheet,
  project: ScubeProject,
  cells: CellMap,
): TakeoffLayout {
  const headers = ['공종', '규격', '단위', '수량', '산출근거'];
  const widths = [20, 26, 8, 16, 52];
  headers.forEach((_h, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? 12;
  });
  styleHeaderRow(ws.addRow(headers));

  const specName = new Map<string, string>();
  for (const s of project.specs) {
    specName.set(s.code, s.spec === '' ? s.name : `${s.name} ${s.spec}`);
  }

  const firstDataRow = 2;
  const qtyCol = 'D';

  // 항목 수량 셀 주소를 먼저 등록 (항목 간 참조 대비).
  project.items.forEach((item, idx) => {
    const rowNum = firstDataRow + idx;
    cells.set(itemQuantityKey(item.id), sheetRef(SHEET_NAMES.takeoff, `${qtyCol}${rowNum}`));
  });

  const cellOf = cells.resolver();
  project.items.forEach((item: TakeoffItem, idx) => {
    const rowNum = firstDataRow + idx;
    const formula = renderExcelFormula(item.basis, cellOf);
    const row = ws.addRow([
      item.workType,
      specName.get(item.specCode) ?? item.specCode,
      item.unit,
      null, // 수량 — 아래에서 수식 셀
      `=${formula}`, // 사람이 읽는 산출근거 (셀 참조가 보이는 계산식)
    ]);
    applyBodyStyle(row);

    // 수량 셀 = 수식 (P4-12, 절대 타협 금지 — 값이 아니라 basis 트리의 셀 참조 수식)
    const qtyAddr = `${qtyCol}${rowNum}`;
    ws.getCell(qtyAddr).value = { formula };
    ws.getCell(qtyAddr).numFmt = NUM_FMT.quantity;
    ws.getCell(qtyAddr).alignment = { horizontal: 'right', vertical: 'middle' };
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    printTitlesRow: '1:1',
  };

  return {
    firstDataRow,
    lastDataRow: firstDataRow + Math.max(project.items.length, 1) - 1,
    workTypeCol: 'A',
    qtyCol,
  };
}

/**
 * ── 2) 집계표 시트 (P4-11) ───────────────────────────────
 *
 * 공종별 합계를 수량산출서 SUMIF 로 참조한다 (P4-12) — 합계도 값이 아니라 수식.
 * 집계표 합계 = 수량산출서 합계가 수식으로 자동 일치한다.
 */
function buildSummarySheet(
  ws: ExcelJS.Worksheet,
  project: ScubeProject,
  takeoff: TakeoffLayout,
): void {
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 18;
  styleHeaderRow(ws.addRow(['공종', '합계수량']));

  // 공종 목록 (입력 순서 유지, 중복 제거)
  const workTypes: string[] = [];
  const seen = new Set<string>();
  for (const item of project.items) {
    if (!seen.has(item.workType)) {
      seen.add(item.workType);
      workTypes.push(item.workType);
    }
  }

  const sheet = SHEET_NAMES.takeoff;
  const wtStart = sheetRef(sheet, `${takeoff.workTypeCol}${takeoff.firstDataRow}`);
  const wtRange = `${wtStart}:${takeoff.workTypeCol}${takeoff.lastDataRow}`;
  const qtyStart = sheetRef(sheet, `${takeoff.qtyCol}${takeoff.firstDataRow}`);
  const qtyRange = `${qtyStart}:${takeoff.qtyCol}${takeoff.lastDataRow}`;

  let rowNum = 2;
  for (const wt of workTypes) {
    const row = ws.addRow([wt, null]);
    applyBodyStyle(row);
    // SUMIF(수량산출서 공종범위, 이 공종, 수량산출서 수량범위) — 수식 참조 (P4-12)
    const sumAddr = `B${rowNum}`;
    ws.getCell(sumAddr).value = { formula: `SUMIF(${wtRange},A${rowNum},${qtyRange})` };
    ws.getCell(sumAddr).numFmt = NUM_FMT.quantity;
    ws.getCell(sumAddr).alignment = { horizontal: 'right', vertical: 'middle' };
    rowNum += 1;
  }

  // 총합계 = 집계표 합계 열 SUM (수량산출서 전체와 자동 일치)
  if (workTypes.length > 0) {
    const totalRow = ws.addRow(['총 합계', null]);
    applyBodyStyle(totalRow);
    ws.getCell(`A${rowNum}`).font = { name: KOREAN_FONT, bold: true, size: 10 };
    const totalAddr = `B${rowNum}`;
    ws.getCell(totalAddr).value = { formula: `SUM(B2:B${rowNum - 1})` };
    ws.getCell(totalAddr).numFmt = NUM_FMT.quantity;
    ws.getCell(totalAddr).font = { name: KOREAN_FONT, bold: true, size: 10 };
    ws.getCell(totalAddr).alignment = { horizontal: 'right', vertical: 'middle' };
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, printTitlesRow: '1:1' };
}

/**
 * ScubeProject → 수량산출서 xlsx (P4-11 ~ P4-13).
 *
 * 시트 순서: 표지 → 집계표 → 수량산출서 → 측점별 상세 → 측정 원장.
 * 시트는 표시 순서로 먼저 생성해두고, 셀 배치는 의존 순서(상세·측정 → 수량산출서 →
 * 집계표)로 채운다. 수량 셀은 값이 아니라 수식이다 (P4-12).
 */
export async function buildWorkbook(project: ScubeProject): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = project.meta.author || 'S-CUBE';
  wb.created = new Date();

  // 표시 순서대로 시트 먼저 생성 (ExcelJS 는 생성 순서가 곧 탭 순서)
  const coverWs = wb.addWorksheet(SHEET_NAMES.cover);
  const summaryWs = wb.addWorksheet(SHEET_NAMES.summary);
  const takeoffWs = wb.addWorksheet(SHEET_NAMES.takeoff);
  const detailWs = wb.addWorksheet(SHEET_NAMES.detail);
  const ledgerWs = wb.addWorksheet(SHEET_NAMES.ledger);

  const cells = new CellMap();

  // 1-pass: 상세·측정 시트 셀 배치 (참조 대상 값 등록)
  buildDetailSheet(detailWs, project, cells);
  buildLedgerSheet(ledgerWs, project, cells);

  // 2-pass: 수량산출서 수식 렌더 (상세/측정 셀 참조)
  const takeoffLayout = buildTakeoffSheet(takeoffWs, project, cells);

  // 집계표: 수량산출서 SUMIF 참조
  buildSummarySheet(summaryWs, project, takeoffLayout);

  // 표지 (참조 없음)
  buildCoverSheet(coverWs, project);

  const buffer = await wb.xlsx.writeBuffer();
  return toArrayBuffer(buffer);
}

/** ExcelJS writeBuffer 결과(Node Buffer)를 ArrayBuffer 로 정규화 */
function toArrayBuffer(buffer: ExcelJS.Buffer): ArrayBuffer {
  const view = buffer as unknown as Uint8Array;
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}
