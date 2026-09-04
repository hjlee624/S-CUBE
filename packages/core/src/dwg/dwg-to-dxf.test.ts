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
