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

describe('parseAndNormalizeDxf — synthetic-far-outlier.dxf (상대 좌표 이상치)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-far-outlier.dxf'));

  it('bounds가 밀집 클러스터 규모 — ~1e11 정점 폴리라인에 오염되지 않음', () => {
    expect(model.bounds).not.toBeNull();
    // 밀집 사각형들은 (100,100)~(107,105)에 모여 있다. 정점 하나가 1e11인 이상치
    // 폴리라인의 bbox 중심이 도면 밖으로 튀어 절대-임계(1e12)는 통과하지만,
    // 상대 이상치 검출로 폐기되어 bounds가 밀집 규모로 남아야 한다.
    expect((model.bounds?.maxX ?? 0) - (model.bounds?.minX ?? 0)).toBeLessThan(1e3);
    expect(model.bounds?.maxX).toBeLessThan(1e6); // 1e11에 오염되지 않음
  });

  it('sanitizedCount ≥ 1 — 상대 이상치가 집계됨 (조용히 버리지 않음)', () => {
    expect(model.sanitizedCount).toBeGreaterThanOrEqual(1);
  });

  it('이상치 폴리라인(OUT1)만 폐기되고 밀집 사각형은 모두 유지', () => {
    expect(model.entities.some((e) => e.handle === 'OUT1')).toBe(false);
    // 밀집 사각형 12개는 온전히 남는다
    const squares = model.entities.filter((e): e is NPolyline => e.kind === 'polyline');
    expect(squares).toHaveLength(12);
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

describe('parseAndNormalizeDxf — synthetic-dim-block.dxf (치수블록 전개 + BYBLOCK/layer-0 상속)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-dim-block.dxf'));
  const dims = model.entities.filter((e): e is NDimension => e.kind === 'dimension');
  const texts = model.entities.filter((e): e is NText => e.kind === 'text');
  const lines = model.entities.filter((e): e is NLine => e.kind === 'line');

  it('DIMENSION 2개 — 블록 있는 것만 hasPicture', () => {
    expect(dims).toHaveLength(2);
    const withBlock = dims.find((d) => d.handle === 'D1');
    const withoutBlock = dims.find((d) => d.handle === 'D2');
    expect(withBlock?.hasPicture).toBe(true);
    // 블록 없는 DIMENSION은 hasPicture 미설정(false) — defPoints 근사 유지
    expect(withoutBlock?.hasPicture).toBeUndefined();
  });

  it('치수블록 전개로 MTEXT가 text 엔티티로 나타난다(값 정확)', () => {
    const dimText = texts.find((t) => t.value === '치수값');
    expect(dimText).toBeDefined();
    // 치수블록 좌표는 WCS(항등) — MTEXT 위치 (50,5) 보존
    expect(dimText?.pos).toEqual({ x: 50, y: 5 });
    // 전개 출처(blockPath)에 치수블록명 보존
    expect(dimText?.origin?.blockPath).toEqual(['*D1']);
  });

  it('BYBLOCK 색·layer-0 상속 — 텍스트/선이 부모(DIM/색1)를 물려받는다', () => {
    const dimText = texts.find((t) => t.value === '치수값');
    // layer '0' → 부모 DIMENSION 레이어 'DIM'
    expect(dimText?.layer).toBe('DIM');
    // colorIndex 0(BYBLOCK) → 부모 색 1
    expect(dimText?.colorIndex).toBe(1);
    const dimLine = lines.find((l) => l.origin?.blockPath?.includes('*D1'));
    expect(dimLine).toBeDefined();
    expect(dimLine?.layer).toBe('DIM');
    expect(dimLine?.colorIndex).toBe(1);
  });

  it('전개된 치수 그림이 실제 엔티티로 추가됨(text≥1, line≥1)', () => {
    expect(texts.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('parseAndNormalizeDxf — synthetic-orphan-block.dxf (고아 블록 감지)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-orphan-block.dxf'));

  it('정의만 되고 INSERT 없는 대형 블록(LINE 60개)이 orphanedBlockCount로 집계됨', () => {
    // DESIGN 블록은 어떤 top-level INSERT로도 도달 불가 → 엔티티 60개가 손실 규모로 잡힌다.
    expect(model.orphanedBlockCount).toBeGreaterThanOrEqual(60);
  });

  it('정상 사각형은 렌더 대상으로 남는다(고아 감지가 정상 엔티티를 지우지 않음)', () => {
    // 배치된 MODEL 사각형은 entities에 존재하고 bounds는 100×100 규모.
    expect(model.entities).toHaveLength(1);
    const sq = model.entities[0] as NPolyline;
    expect(sq.kind).toBe('polyline');
    expect(sq.layer).toBe('MODEL');
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });
});

describe('parseAndNormalizeDxf — synthetic-large-dim-block.dxf (대형 치수블록 오탐 방지)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-large-dim-block.dxf'));

  it('top-level DIMENSION이 참조하는 60-엔티티 치수블록(*D60)은 고아 아님', () => {
    // *D60은 어떤 top-level INSERT로도 도달 불가하지만, top-level DIMENSION.block(그룹코드 2)이
    // 참조하고 expand.ts가 실제로 전개해 렌더한다. 도달성 계산이 DIMENSION.block을 루트로
    // seed해야 임계(50) 이상 치수 그림 블록을 고아로 오탐하지 않는다.
    expect(model.orphanedBlockCount).toBe(0);
  });

  it('치수블록이 실제 렌더 엔티티로 전개됨(LINE 60개 이상)', () => {
    const lines = model.entities.filter((e): e is NLine => e.kind === 'line');
    expect(lines.length).toBeGreaterThanOrEqual(60);
    expect(lines.every((l) => l.origin?.blockPath?.includes('*D60'))).toBe(true);
  });
});

describe('parseAndNormalizeDxf — 고아 블록 회귀(기존 fixture는 orphanedBlockCount 0)', () => {
  // 정상 fixture는 고아 블록이 없어야 한다(정의된 블록이 모두 배치되거나 소형).
  for (const name of [
    'synthetic-square100.dxf',
    'synthetic-blocks.dxf',
    'synthetic-paperspace.dxf',
    'synthetic-dim-block.dxf',
    'synthetic-large-dim-block.dxf',
    'synthetic-units-mm.dxf',
    'synthetic-bulge.dxf',
  ]) {
    it(`${name} → orphanedBlockCount 0`, () => {
      const model = parseAndNormalizeDxf(readFixture(name));
      expect(model.orphanedBlockCount).toBe(0);
    });
  }
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
