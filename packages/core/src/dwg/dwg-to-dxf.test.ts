import { describe, expect, it } from 'vitest';
import { parseAndNormalizeDxf } from '../dxf/pipeline.ts';
import {
  type DwgLikeBlockRecord,
  type DwgLikeDatabase,
  type DwgLikeEntity,
  type DwgLikeLayer,
  dwgDatabaseToDxf,
} from './dwg-to-dxf.ts';

/** 최소 DwgDatabase 조립 헬퍼 */
function db(
  entities: DwgLikeEntity[],
  opts: {
    layers?: DwgLikeLayer[];
    blocks?: DwgLikeBlockRecord[];
    insunits?: number;
  } = {},
): DwgLikeDatabase {
  const blockEntries: DwgLikeBlockRecord[] = [
    { name: '*Model_Space', entities: [] },
    ...(opts.blocks ?? []),
  ];
  return {
    entities,
    header: { INSUNITS: opts.insunits ?? 6 },
    tables: {
      LAYER: { entries: opts.layers ?? [{ name: '0', colorIndex: 7 }] },
      BLOCK_RECORD: { entries: blockEntries },
    },
  };
}

describe('dwgDatabaseToDxf — 기본 엔티티 라운드트립 (RW-24)', () => {
  it('LINE → parse 후 line 엔티티·좌표 보존', () => {
    const { dxf, emitted } = dwgDatabaseToDxf(
      db([
        {
          type: 'LINE',
          handle: 'A1',
          layer: '0',
          startPoint: { x: 0, y: 0, z: 0 },
          endPoint: { x: 10, y: 5, z: 0 },
        },
      ]),
    );
    expect(emitted).toBe(1);
    const model = parseAndNormalizeDxf(dxf);
    const line = model.entities.find((e) => e.kind === 'line');
    expect(line).toBeDefined();
    if (line?.kind === 'line') {
      expect(line.a.x).toBeCloseTo(0, 6);
      expect(line.b.x).toBeCloseTo(10, 6);
      expect(line.b.y).toBeCloseTo(5, 6);
      expect(line.handle).toBe('A1');
    }
  });

  it('CIRCLE·ARC 좌표·반지름·각도 보존(각도 rad→deg→rad 왕복)', () => {
    const { dxf } = dwgDatabaseToDxf(
      db([
        { type: 'CIRCLE', handle: 'C1', layer: '0', center: { x: 5, y: 5 }, radius: 2 },
        {
          type: 'ARC',
          handle: 'AR1',
          layer: '0',
          center: { x: 0, y: 0 },
          radius: 3,
          startAngle: 0,
          endAngle: Math.PI / 2,
        },
      ]),
    );
    const model = parseAndNormalizeDxf(dxf);
    const circle = model.entities.find((e) => e.kind === 'circle');
    const arc = model.entities.find((e) => e.kind === 'arc');
    expect(circle?.kind === 'circle' && circle.r).toBeCloseTo(2, 6);
    if (arc?.kind === 'arc') {
      expect(arc.r).toBeCloseTo(3, 6);
      expect(arc.a0).toBeCloseTo(0, 4);
      expect(arc.a1).toBeCloseTo(Math.PI / 2, 4);
    }
  });

  it('LWPOLYLINE flag 0x200(512) → closed=true, 없으면 false', () => {
    const closed = dwgDatabaseToDxf(
      db([
        {
          type: 'LWPOLYLINE',
          handle: 'P1',
          layer: '0',
          flag: 512,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
            { x: 10, y: 10, bulge: 0 },
          ],
        },
      ]),
    );
    const openDb = dwgDatabaseToDxf(
      db([
        {
          type: 'LWPOLYLINE',
          handle: 'P2',
          layer: '0',
          flag: 0,
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
          ],
        },
      ]),
    );
    const cm = parseAndNormalizeDxf(closed.dxf);
    const om = parseAndNormalizeDxf(openDb.dxf);
    const cp = cm.entities.find((e) => e.kind === 'polyline');
    const op = om.entities.find((e) => e.kind === 'polyline');
    expect(cp?.kind === 'polyline' && cp.closed).toBe(true);
    expect(op?.kind === 'polyline' && op.closed).toBe(false);
  });

  it('TEXT 값·높이 보존', () => {
    const { dxf } = dwgDatabaseToDxf(
      db([
        {
          type: 'TEXT',
          handle: 'T1',
          layer: '0',
          startPoint: { x: 1, y: 2 },
          textHeight: 2.5,
          text: 'No.8+0.000',
          rotation: 0,
        },
      ]),
    );
    const model = parseAndNormalizeDxf(dxf);
    const text = model.entities.find((e) => e.kind === 'text');
    expect(text?.kind === 'text' && text.value).toBe('No.8+0.000');
    expect(text?.kind === 'text' && text.height).toBeCloseTo(2.5, 6);
  });
});

describe('dwgDatabaseToDxf — 페이퍼 스페이스 제외 (RW-24 버그수정)', () => {
  it('페이퍼 스페이스(도곽) 엔티티는 모델에서 제외 — 원점 bounds 오염 방지', () => {
    const database: DwgLikeDatabase = {
      entities: [
        {
          type: 'LINE',
          handle: 'M1',
          layer: '0',
          ownerBlockRecordSoftId: 'MS',
          startPoint: { x: 217000, y: 331000 },
          endPoint: { x: 217010, y: 331000 },
        },
        {
          // 페이퍼 스페이스 도곽 — 원점 근처. 제외돼야 한다.
          type: 'LINE',
          handle: 'P1',
          layer: '0',
          ownerBlockRecordSoftId: 'PS',
          startPoint: { x: 0, y: 0 },
          endPoint: { x: 500, y: 350 },
        },
      ],
      header: { INSUNITS: 6 },
      tables: {
        LAYER: { entries: [{ name: '0', colorIndex: 7 }] },
        BLOCK_RECORD: {
          entries: [
            { name: '*Model_Space', handle: 'MS', entities: [] },
            { name: '*Paper_Space', handle: 'PS', entities: [] },
          ],
        },
      },
    };
    const { dxf } = dwgDatabaseToDxf(database);
    const model = parseAndNormalizeDxf(dxf);
    const lines = model.entities.filter((e) => e.kind === 'line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.handle).toBe('M1');
    // bounds 가 실좌표(217000+)여야 하고 원점(0)에 오염되지 않아야 한다.
    expect(model.bounds?.minX ?? 0).toBeGreaterThan(200000);
  });
});

describe('dwgDatabaseToDxf — HATCH 경계 방출 (RW-24)', () => {
  it('line edge 경계 HATCH → 파이프라인이 hatch loop 로 파싱', () => {
    const { dxf } = dwgDatabaseToDxf(
      db([
        {
          type: 'HATCH',
          handle: 'H1',
          layer: 'CS-PATT',
          patternName: 'SOLID',
          solidFill: 1,
          boundaryPaths: [
            {
              boundaryPathTypeFlag: 1,
              numberOfEdges: 3,
              edges: [
                { type: 1, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
                { type: 1, start: { x: 10, y: 0 }, end: { x: 5, y: 8 } },
                { type: 1, start: { x: 5, y: 8 }, end: { x: 0, y: 0 } },
              ],
            },
          ],
        },
      ]),
    );
    const model = parseAndNormalizeDxf(dxf);
    const hatch = model.entities.find((e) => e.kind === 'hatch');
    expect(hatch).toBeDefined();
    if (hatch?.kind === 'hatch') {
      expect(hatch.loops.length).toBeGreaterThan(0);
      expect(hatch.loops[0]?.vertices.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('boundaryPaths 없는 HATCH 는 건너뛴다(skipped 집계)', () => {
    const { emitted, skipped } = dwgDatabaseToDxf(db([{ type: 'HATCH', handle: 'H', layer: '0' }]));
    expect(emitted).toBe(0);
    expect(skipped.HATCH).toBe(1);
  });
});

describe('dwgDatabaseToDxf — INSERT 블록 전개 (RW-24)', () => {
  it('모델 INSERT + 블록 정의 → 파이프라인이 전개(오프셋 반영)', () => {
    const database = db(
      [{ type: 'INSERT', handle: 'I1', layer: '0', name: 'B1', insertionPoint: { x: 100, y: 0 } }],
      {
        blocks: [
          {
            name: 'B1',
            basePoint: { x: 0, y: 0 },
            entities: [
              {
                type: 'LINE',
                handle: 'BL1',
                layer: '0',
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 10, y: 0 },
              },
            ],
          },
        ],
      },
    );
    const { dxf } = dwgDatabaseToDxf(database);
    const model = parseAndNormalizeDxf(dxf);
    // 전개된 라인이 (100,0)-(110,0) 위치에 있어야 한다.
    const line = model.entities.find(
      (e) => e.kind === 'line' && Math.abs(e.a.x - 100) < 1e-6 && Math.abs(e.b.x - 110) < 1e-6,
    );
    expect(line).toBeDefined();
  });
});

describe('dwgDatabaseToDxf — 미지원 형식 집계 (RW-24)', () => {
  it('HATCH·알수없는 형식은 건너뛰고 skipped 집계', () => {
    const { emitted, skipped } = dwgDatabaseToDxf(
      db([
        { type: 'LINE', handle: 'A', layer: '0', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
        { type: 'HATCH', handle: 'H', layer: '0' },
        { type: 'MULTILEADER', handle: 'M', layer: '0' },
        { type: 'HATCH', handle: 'H2', layer: '0' },
      ]),
    );
    expect(emitted).toBe(1);
    expect(skipped.HATCH).toBe(2);
    expect(skipped.MULTILEADER).toBe(1);
  });

  it('ATTRIB(블록 속성값) → TEXT 로 방출 (중첩 text 객체)', () => {
    const { dxf, emitted } = dwgDatabaseToDxf(
      db([
        {
          type: 'ATTRIB',
          handle: 'A1',
          layer: '0',
          tag: 'STATION',
          text: {
            text: 'No.8+0.000',
            startPoint: { x: 5, y: 3 },
            textHeight: 2,
            rotation: 0,
          },
        },
      ]),
    );
    expect(emitted).toBe(1);
    const model = parseAndNormalizeDxf(dxf);
    const text = model.entities.find((e) => e.kind === 'text');
    expect(text?.kind === 'text' && text.value).toBe('No.8+0.000');
  });

  it('ATTDEF 값 없으면 tag 로 폴백, 둘 다 없으면 skip', () => {
    const withTag = dwgDatabaseToDxf(
      db([{ type: 'ATTDEF', handle: 'D1', layer: '0', tag: '측점', text: { startPoint: { x: 0, y: 0 } } }]),
    );
    const mt = parseAndNormalizeDxf(withTag.dxf);
    expect(mt.entities.find((e) => e.kind === 'text' && e.value === '측점')).toBeDefined();
    const empty = dwgDatabaseToDxf(db([{ type: 'ATTDEF', handle: 'D2', layer: '0', text: {} }]));
    expect(empty.emitted).toBe(0);
  });

  it('POLYLINE2D → LWPOLYLINE(polyline) 로 방출', () => {
    const { dxf } = dwgDatabaseToDxf(
      db([
        {
          type: 'POLYLINE2D',
          handle: 'P2',
          layer: '0',
          flag: 1, // 폐합
          vertices: [
            { x: 0, y: 0, bulge: 0 },
            { x: 10, y: 0, bulge: 0 },
            { x: 10, y: 10, bulge: 0 },
          ],
        },
      ]),
    );
    const model = parseAndNormalizeDxf(dxf);
    const poly = model.entities.find((e) => e.kind === 'polyline');
    expect(poly).toBeDefined();
    expect(poly?.kind === 'polyline' && poly.closed).toBe(true);
    expect(poly?.kind === 'polyline' && poly.vertices.length).toBe(3);
  });

  it('레이어 테이블이 모델 layers 로 반영된다', () => {
    const { dxf } = dwgDatabaseToDxf(
      db(
        [{ type: 'LINE', handle: 'A', layer: 'CUT', startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }],
        { layers: [{ name: '0', colorIndex: 7 }, { name: 'CUT', colorIndex: 1 }] },
      ),
    );
    const model = parseAndNormalizeDxf(dxf);
    expect(model.layers.some((l) => l.name === 'CUT')).toBe(true);
  });
});
