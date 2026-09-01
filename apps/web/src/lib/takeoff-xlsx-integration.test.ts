/**
 * 실경로 통합 테스트 (P4-12 게이트) — buildBasis → renderExcelFormula.
 *
 * 기존 workbook.test.ts 는 손으로 만든 ref-기반 basis 를 넣어 통과했으나, 실제 앱 빌더
 * (buildBasis)의 출력이 엑셀 수식으로 어떻게 렌더되는지는 검증하지 못했다(실경로 미검증).
 * 이 테스트는 실제 reassembleItem/buildBasis 로 조립한 basis 를 @s-cube/xlsx 의
 * renderExcelFormula + CellMap(워크북과 동일한 논리 키 등록)으로 렌더해:
 *   (a) 수량 수식이 하드코딩 숫자가 아니라 상세/측정/수량산출서 시트 셀을 참조하는가 (P4-12)
 *   (b) 항목 참조(P4-9) 키가 CellMap 등록 키와 일치해 렌더가 예외 없이 성공하는가
 * 를 단언한다 — 죽은 CellMap 등록·키 불일치(:quantity 접미사) 결함을 못박는다.
 *
 * (buildWorkbook 전체 왕복은 packages/xlsx/workbook.test.ts 가 exceljs 로 담당한다.
 *  여기서는 web 이 exceljs 직접 의존 없이 렌더 계약만 검증한다.)
 */
import type { Measurement, StationSection } from '@s-cube/schema';
import {
  CellMap,
  itemQuantityKey,
  measurementValueKey,
  renderExcelFormula,
  segmentKey,
  sheetRef,
} from '@s-cube/xlsx';
import { describe, expect, it } from 'vitest';
import { evaluatePlain, type TakeoffSource } from './takeoff-build.ts';
import { type EditableTakeoffItem, reassembleItem } from './takeoff-derive.ts';

const DETAIL = '측점별 상세';
const LEDGER = '측정 원장';
const TAKEOFF = '수량산출서';

function station(no: number) {
  return { raw: `No.${no}+0.000`, no, plus_m: 0, chainage_m: no * 20, discontinuity: null };
}

function sec(id: string, no: number, area_m2: number): StationSection {
  return { id, station: station(no), itemKey: '절토', area_m2 };
}

function meas(id: string, value: number): Measurement {
  return {
    id,
    drawingId: 'd1',
    kind: 'length',
    value,
    rawValue: value,
    method: 'manual',
    sourceHandles: ['1A2B'],
    label: `${id} 연장`,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function assemble(
  id: string,
  source: TakeoffSource,
  sections: StationSection[],
  measurements: Measurement[],
  allItems: EditableTakeoffItem[],
): EditableTakeoffItem {
  return reassembleItem(
    { id, workType: '토공사', name: id, specCode: '', unit: '㎥', source, sourceRefs: [] },
    undefined,
    sections,
    allItems,
    measurements,
  );
}

/**
 * 워크북 1-pass 레이아웃이 등록하는 논리 키를 그대로 모사한 CellMap.
 * (workbook.ts buildDetailSheet/buildLedgerSheet/buildTakeoffSheet 와 동일 규약)
 */
function cellMapFor(
  sections: StationSection[],
  measurements: Measurement[],
  itemIds: string[],
): CellMap {
  const cells = new CellMap();
  // 상세 시트: 각 단면적, 인접 구간 체적. segId = `${fromId}~${toId}` (chainage 정렬).
  const sorted = [...sections].sort((a, b) => a.station.chainage_m - b.station.chainage_m);
  sorted.forEach((s, i) => {
    cells.set(`section:${s.id}:area`, sheetRef(DETAIL, `C${i + 2}`));
  });
  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === undefined || to === undefined) continue;
    const segId = `${from.id}~${to.id}`;
    cells.set(segmentKey(segId, 'a1'), sheetRef(DETAIL, `C${i + 2}`));
    cells.set(segmentKey(segId, 'a2'), sheetRef(DETAIL, `C${i + 3}`));
    cells.set(segmentKey(segId, 'length'), sheetRef(DETAIL, `D${100 + i}`));
    cells.set(segmentKey(segId, 'volume'), sheetRef(DETAIL, `F${100 + i}`));
  }
  // 측정 원장.
  measurements.forEach((m, i) => {
    cells.set(measurementValueKey(m.id), sheetRef(LEDGER, `G${i + 2}`));
  });
  // 수량산출서 항목 수량 셀.
  itemIds.forEach((id, i) => {
    cells.set(itemQuantityKey(id), sheetRef(TAKEOFF, `D${i + 2}`));
  });
  return cells;
}

describe('실빌더 → 엑셀 수식 실경로 (P4-12 게이트)', () => {
  const sections = [sec('ss-1', 8, 12.5), sec('ss-2', 9, 14.2), sec('ss-3', 10, 10)];
  const measurements = [meas('m-1', 120.5)];

  it('구간 체적 항목 수식은 상세 시트 체적 셀을 참조한다 (하드코딩 단면적 없음)', () => {
    const cut = assemble(
      'cut',
      { kind: 'segment-volume', itemKey: '절토' },
      sections,
      measurements,
      [],
    );
    expect(cut.basis).not.toBeNull();
    if (cut.basis === null) return;
    const cells = cellMapFor(sections, measurements, ['cut']);
    const formula = renderExcelFormula(cut.basis, cells.resolver());
    // 상세 시트 체적 셀 참조 (F 열). 단면적/연장 리터럴이 박히면 안 된다.
    expect(formula).toContain(`'${DETAIL}'!F`);
    expect(formula).not.toContain('12.5');
    expect(formula).not.toContain('14.2');
    // 두 구간 합이므로 '+' 로 이어진 두 셀 참조.
    expect(formula).toMatch(/F100.*\+.*F101/);
  });

  it('측정 소스 항목 수식은 측정 원장 셀을 참조한다 (측정값 리터럴 없음)', () => {
    const rebar = assemble(
      'rebar',
      { kind: 'measurement', measurementId: 'm-1', value: 120.5, label: 'm-1' },
      sections,
      measurements,
      [],
    );
    expect(rebar.basis).not.toBeNull();
    if (rebar.basis === null) return;
    const cells = cellMapFor(sections, measurements, ['rebar']);
    const formula = renderExcelFormula(rebar.basis, cells.resolver());
    expect(formula).toContain(`'${LEDGER}'!G2`);
    expect(formula).not.toContain('120.5');
  });

  it('항목 참조(P4-9)는 :quantity 접미사 키로 등록된 수량산출서 셀을 참조한다 (렌더 예외 없음)', () => {
    const cut = assemble(
      'cut',
      { kind: 'segment-volume', itemKey: '절토' },
      sections,
      measurements,
      [],
    );
    const derived = assemble(
      'derived',
      {
        kind: 'ref',
        refItemIds: ['cut'],
        refs: [{ itemId: 'cut', label: '절토량', quantity: cut.quantity }],
        factor: 0.5,
      },
      sections,
      measurements,
      [cut],
    );
    expect(derived.basis).not.toBeNull();
    if (derived.basis === null) return;
    const cells = cellMapFor(sections, measurements, ['cut', 'derived']);
    // 이전 결함: buildRefNode 가 item:cut 을, CellMap 은 item:cut:quantity 를 써서 예외.
    // 이제 통일됐으므로 예외 없이 D2(=cut 행)를 참조해야 한다.
    const formula = renderExcelFormula(derived.basis, cells.resolver());
    expect(formula).toContain(`'${TAKEOFF}'!D2`);
  });

  it('수식 값(evaluatePlain) 이 양단면평균법 합과 일치한다', () => {
    const cut = assemble(
      'cut',
      { kind: 'segment-volume', itemKey: '절토' },
      sections,
      measurements,
      [],
    );
    expect(cut.basis).not.toBeNull();
    if (cut.basis === null) return;
    const expected = ((12.5 + 14.2) / 2) * 20 + ((14.2 + 10) / 2) * 20;
    expect(evaluatePlain(cut.basis, { sections, measurements })).toBeCloseTo(expected, 9);
    expect(cut.quantity).toBeCloseTo(expected, 9);
  });
});
