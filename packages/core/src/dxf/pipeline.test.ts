import { readFileSync } from 'node:fs';
import type { NDimension, NLine, NPolyline, NText } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { polylineLength } from '../geometry/primitives.ts';
import { UNSUPPORTED_KEY_DEPTH_EXCEEDED } from './expand.ts';
import { parseAndNormalizeDxf } from './pipeline.ts';

function readFixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseAndNormalizeDxf — synthetic-square100.dxf', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-square100.dxf'));

  it('폐합 LWPOLYLINE 1개, 좌표 정확', () => {
    expect(model.entities).toHaveLength(1);
    const poly = model.entities[0] as NPolyline;
    expect(poly.kind).toBe('polyline');
    expect(poly.closed).toBe(true);
    expect(poly.handle).toBe('A1');
    expect(poly.layer).toBe('WALL');
    expect(poly.vertices.map((v) => [v.p.x, v.p.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    expect(polylineLength(poly.vertices, poly.closed)).toBeCloseTo(400, 12);
  });

  it('헤더·레이어·bounds', () => {
    expect(model.dxfVersion).toBe('AC1015');
    expect(model.insUnits).toBe(0); // $INSUNITS 없음 → 단위 불명
    const wall = model.layers.find((l) => l.name === 'WALL');
    expect(wall).toBeDefined();
    expect(wall?.colorIndex).toBe(3);
    expect(wall?.visible).toBe(true);
    expect(wall?.entityCount).toBe(1);
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(model.unsupportedCounts).toEqual({});
    expect(model.sanitizedCount).toBe(0);
  });
});

describe('parseAndNormalizeDxf — synthetic-bad-coord.dxf (좌표 위생처리)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-bad-coord.dxf'));

  it('bounds가 정상 사각형 규모 — 1e305 정점에 오염되지 않음', () => {
    expect(model.bounds).not.toBeNull();
    // WALL 사각형 (0,0)~(100,100). 손상 폴리라인의 정상 정점(5..50)은 이 안에 포함된다.
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    // 유한하고 실측 규모(수백 mm)여야 한다
    expect(Number.isFinite(model.bounds?.maxX)).toBe(true);
    expect((model.bounds?.maxX ?? 0) - (model.bounds?.minX ?? 0)).toBeLessThan(1e6);
  });

  it('sanitizedCount ≥ 1 — 손상 정점 폴리라인이 집계됨 (조용히 버리지 않음)', () => {
    expect(model.sanitizedCount).toBeGreaterThanOrEqual(1);
  });

  it('정상 WALL 폴리라인은 온전히 남는다', () => {
    const wall = model.entities.find(
      (e): e is NPolyline => e.kind === 'polyline' && e.layer === 'WALL',
    );
    expect(wall?.vertices).toHaveLength(4);
  });
});

describe('parseAndNormalizeDxf — synthetic-paperspace.dxf (레이아웃 제외)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-paperspace.dxf'));

  it('페이퍼 스페이스(도곽) 엔티티는 제외되고 모델 공간만 남는다', () => {
    // MODEL 레이어 사각형만 남고, TITLEBLOCK(67=1) LINE은 제외
    expect(model.entities).toHaveLength(1);
    expect(model.entities[0]?.layer).toBe('MODEL');
    expect(model.entities.some((e) => e.layer === 'TITLEBLOCK')).toBe(false);
  });

  it('paperSpaceExcludedCount로 제외 수를 집계한다 (조용히 버리지 않음)', () => {
    expect(model.paperSpaceExcludedCount).toBe(1);
  });

  it('bounds가 도곽(841×594)이 아니라 모델 사각형(100×100) 규모여야 한다', () => {
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });
});

describe('parseAndNormalizeDxf — synthetic-mtext-codes.dxf (MTEXT 디코딩)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-mtext-codes.dxf'));

  it('MTEXT 서식코드가 평문으로 디코딩되고 \\P가 줄바꿈으로', () => {
    const text = model.entities.find((e): e is NText => e.kind === 'text');
    expect(text).toBeDefined();
    expect(text?.value).toBe('1. 본 도면\n2. 다음 1/2 참조');
    expect(text?.pos).toEqual({ x: 10, y: 20 });
  });
});

describe('parseAndNormalizeDxf — synthetic-bulge.dxf', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-bulge.dxf'));

  it('bulge=1 반원 세그먼트 보존, 호장 = πr', () => {
    expect(model.entities).toHaveLength(1);
    const poly = model.entities[0] as NPolyline;
    expect(poly.kind).toBe('polyline');
    expect(poly.closed).toBe(false);
    expect(poly.vertices).toHaveLength(2);
    expect(poly.vertices[0]?.bulge).toBe(1);
    expect(polylineLength(poly.vertices, poly.closed)).toBeCloseTo(Math.PI * 50, 9);
  });

  it('bounds가 호의 사분점(50,-50)까지 확장', () => {
    expect(model.bounds).not.toBeNull();
    expect(model.bounds?.minX).toBeCloseTo(0, 9);
    expect(model.bounds?.maxX).toBeCloseTo(100, 9);
    expect(model.bounds?.minY).toBeCloseTo(-50, 9);
    expect(model.bounds?.maxY).toBeCloseTo(0, 9);
  });
});

describe('parseAndNormalizeDxf — synthetic-blocks.dxf (2단 중첩 INSERT)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-blocks.dxf'));
  const lines = model.entities.filter((e): e is NLine => e.kind === 'line');

  it('전개 후 LINE 4개', () => {
    expect(model.entities).toHaveLength(4);
    expect(lines).toHaveLength(4);
  });

  it('INSERT PAIR @(100,100) rot0 — 손계산 world 좌표 일치', () => {
    // PAIR 내부: UNIT@identity → (100,100)-(110,100)
    const l0 = lines[0];
    expect(l0?.a.x).toBeCloseTo(100, 9);
    expect(l0?.a.y).toBeCloseTo(100, 9);
    expect(l0?.b.x).toBeCloseTo(110, 9);
    expect(l0?.b.y).toBeCloseTo(100, 9);
    // PAIR 내부: UNIT@(20,0) scale2 rot90 → (120,100)-(120,120)
    const l1 = lines[1];
    expect(l1?.a.x).toBeCloseTo(120, 9);
    expect(l1?.a.y).toBeCloseTo(100, 9);
    expect(l1?.b.x).toBeCloseTo(120, 9);
    expect(l1?.b.y).toBeCloseTo(120, 9);
  });

  it('INSERT PAIR @(0,0) rot90 — 외부 회전 누적', () => {
    // UNIT@identity에 외부 rot90 → (0,0)-(0,10)
    const l2 = lines[2];
    expect(l2?.a.x).toBeCloseTo(0, 9);
    expect(l2?.a.y).toBeCloseTo(0, 9);
    expect(l2?.b.x).toBeCloseTo(0, 9);
    expect(l2?.b.y).toBeCloseTo(10, 9);
    // 내부 (20,0)-(20,20)에 외부 rot90 → (0,20)-(-20,20)
    const l3 = lines[3];
    expect(l3?.a.x).toBeCloseTo(0, 9);
    expect(l3?.a.y).toBeCloseTo(20, 9);
    expect(l3?.b.x).toBeCloseTo(-20, 9);
    expect(l3?.b.y).toBeCloseTo(20, 9);
  });

  it('EntityOrigin — blockPath와 transform 보존', () => {
    const l1 = lines[1];
    expect(l1?.origin?.blockPath).toEqual(['PAIR', 'UNIT']);
    expect(l1?.origin?.transform).toBeDefined();
    expect(l1?.handle).toBe('L1'); // 원본 handle 유지 (역추적)
  });

  it('전체 bounds — 손계산 (-20,0)~(120,120)', () => {
    expect(model.bounds?.minX).toBeCloseTo(-20, 9);
    expect(model.bounds?.minY).toBeCloseTo(0, 9);
    expect(model.bounds?.maxX).toBeCloseTo(120, 9);
    expect(model.bounds?.maxY).toBeCloseTo(120, 9);
  });
});

describe('parseAndNormalizeDxf — synthetic-units-mm.dxf', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-units-mm.dxf'));

  it('$INSUNITS=4 (밀리미터), $ACADVER', () => {
    expect(model.insUnits).toBe(4);
    expect(model.dxfVersion).toBe('AC1015');
  });

  it('LINE + DIMENSION 정규화', () => {
    expect(model.entities).toHaveLength(2);
    const line = model.entities.find((e): e is NLine => e.kind === 'line');
    expect(line?.a).toEqual({ x: 0, y: 0 });
    expect(line?.b).toEqual({ x: 1000, y: 0 });
    const dim = model.entities.find((e): e is NDimension => e.kind === 'dimension');
    expect(dim?.measuredRaw).toBe(1000);
    expect(dim?.textOverride).toBeNull(); // '<>'는 override 아님
    expect(dim?.defPoints.length).toBeGreaterThanOrEqual(2);
  });

  it('HATCH는 미지원으로 집계 (dxf-parser 1.1.2 핸들러 없음)', () => {
    expect(model.unsupportedCounts.HATCH).toBe(1);
  });
});

describe('parseAndNormalizeDxf — 오류·순환 참조', () => {
  it('빈 입력은 한국어 메시지로 실패', () => {
    expect(() => parseAndNormalizeDxf('')).toThrow(/DXF 파싱 실패/);
  });

  it('자기 자신을 INSERT하는 블록은 depth 제한으로 종료', () => {
    const cyclic = [
      '0,SECTION,2,BLOCKS',
      '0,BLOCK,5,B1,8,0,2,LOOP,70,0,10,0.0,20,0.0',
      '0,LINE,5,L1,8,0,10,0.0,20,0.0,11,1.0,21,0.0',
      '0,INSERT,5,I1,8,0,2,LOOP,10,10.0,20,0.0',
      '0,ENDBLK',
      '0,ENDSEC',
      '0,SECTION,2,ENTITIES',
      '0,INSERT,5,I0,8,0,2,LOOP,10,0.0,20,0.0',
      '0,ENDSEC',
      '0,EOF',
    ]
      .join(',')
      .split(',')
      .join('\n');
    const model = parseAndNormalizeDxf(cyclic);
    // 깊이 1~16에서 LINE 16개 전개 후 17번째 INSERT에서 중단
    expect(model.entities).toHaveLength(16);
    expect(model.unsupportedCounts[UNSUPPORTED_KEY_DEPTH_EXCEEDED]).toBe(1);
  });
});
