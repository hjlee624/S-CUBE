import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hatchArea } from '../geometry/area.ts';
import { parseHatchEntities } from './parse-hatch.ts';
import { parseAndNormalizeDxf } from './pipeline.ts';

function readFixture(name: string): string {
  return readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url), 'utf8');
}

describe('parseHatchEntities — 폴리라인 경계 (외곽 + 내부 구멍)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-poly.dxf'));
  const hatch = model.entities.find((e) => e.kind === 'hatch');

  it('NHatch 1개, loop 2개(외곽 1 + 구멍 1)로 정규화', () => {
    expect(model.entities).toHaveLength(1);
    expect(hatch?.kind).toBe('hatch');
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatch.loops).toHaveLength(2);
    expect(hatch.loops.filter((l) => l.isOuter)).toHaveLength(1);
    // 외곽(92 bit0=external)이 isOuter, 내부 구멍은 아님
    const outer = hatch.loops.find((l) => l.isOuter);
    const hole = hatch.loops.find((l) => !l.isOuter);
    expect(outer?.vertices).toHaveLength(4);
    expect(hole?.vertices).toHaveLength(4);
    expect(hatch.layer).toBe('FILL');
    expect(hatch.handle).toBe('H1');
    expect(hatch.colorIndex).toBe(2);
  });

  it('외곽 좌표 정확 (100×100 사각형)', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    const outer = hatch.loops.find((l) => l.isOuter);
    expect(outer?.vertices.map((v) => [v.p.x, v.p.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  it('hatchArea = 외곽(10000) − 구멍(1600) = 8400', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatchArea(hatch.loops)).toBe(8400);
  });

  it('unsupportedCounts.HATCH는 지원되어 제거됨', () => {
    expect(model.unsupportedCounts.HATCH).toBeUndefined();
  });
});

describe('parseHatchEntities — 다중 외곽(disjoint) + 섬(island) even-odd 분류', () => {
  // 92 external bit 를 일부러 오설정(섬=external, 두번째 외곽=non-external)해도
  // even-odd 포함 깊이로 올바르게 분류됨을 검증한다.
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-multi-external.dxf'));
  const hatch = model.entities.find((e) => e.kind === 'hatch');

  it('loop 3개 — 외곽 2(깊이0) + 구멍 1(깊이1)', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatch.loops).toHaveLength(3);
    expect(hatch.loops.filter((l) => l.isOuter)).toHaveLength(2);
    expect(hatch.loops.filter((l) => !l.isOuter)).toHaveLength(1);
  });

  it('hatchArea = 외곽1(10000) + 외곽2(10000) − 섬(1600) = 18400', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatchArea(hatch.loops)).toBeCloseTo(18400, 9);
  });
});

describe('parseHatchEntities — 섬-속-섬(island-in-island) even-odd 분류', () => {
  // 깊이 0(외곽·채움) / 1(구멍) / 2(다시 채움). external bit 기반이면 섬-속-섬을
  // 구멍으로 오차감하므로 이 케이스로 명세 준수를 고정한다.
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-island-in-island.dxf'));
  const hatch = model.entities.find((e) => e.kind === 'hatch');

  it('loop 3개 — 깊이 0·2(채움 2) + 깊이 1(구멍 1)', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatch.loops).toHaveLength(3);
    // 외곽(깊이0) + 안쪽 섬(깊이2) = 채움 2, 중간(깊이1) = 구멍 1
    expect(hatch.loops.filter((l) => l.isOuter)).toHaveLength(2);
    expect(hatch.loops.filter((l) => !l.isOuter)).toHaveLength(1);
  });

  it('hatchArea = 10000 − 3600(구멍) + 400(안쪽 섬) = 6800', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatchArea(hatch.loops)).toBeCloseTo(6800, 9);
  });
});

describe('parseHatchEntities — 모델 HATCH 구조 파싱 실패 집계 (P1-2)', () => {
  // 성공 HATCH 1 + 실패 HATCH 1(91 없음). 사전 스캔은 HATCH 2로 세지만
  // unsupportedCounts.HATCH 는 사전 스캔값이 아니라 failedCount(=1)를 반영해야 한다.
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-mixed-fail.dxf'));

  it('성공 HATCH 1개만 엔티티로 정규화', () => {
    const hatches = model.entities.filter((e) => e.kind === 'hatch');
    expect(hatches).toHaveLength(1);
    expect(hatches[0]?.handle).toBe('HGOOD');
  });

  it('unsupportedCounts.HATCH === failedCount(=1) — 사전 스캔 총계(2)와 무관', () => {
    const r = parseHatchEntities(readFixture('synthetic-hatch-mixed-fail.dxf'));
    expect(r.failedCount).toBe(1);
    expect(model.unsupportedCounts.HATCH).toBe(1);
  });
});

describe('parseHatchEntities — edge-type 경계 (line + arc)', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-edge.dxf'));
  const hatch = model.entities.find((e) => e.kind === 'hatch');

  it('line·arc edge를 점열 근사한 단일 폐합 loop', () => {
    expect(hatch?.kind).toBe('hatch');
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    expect(hatch.loops).toHaveLength(1);
    // line(2점) + 반원 arc(≈64분할) 근사 → 충분한 정점 수
    const loop = hatch.loops[0];
    expect(loop?.vertices.length).toBeGreaterThan(10);
    expect(loop?.isOuter).toBe(true);
  });

  it('반원판 면적 ≈ ½·π·50² = 3926.99 (근사 오차 0.1% 이내)', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    const expected = 0.5 * Math.PI * 50 * 50;
    const area = hatchArea(hatch.loops);
    expect(area).toBeGreaterThan(0);
    expect(Math.abs(area - expected) / expected).toBeLessThan(1e-3);
  });

  it('edge 경계가 폐합 — 첫 정점과 끝 정점이 근접', () => {
    if (hatch?.kind !== 'hatch') throw new Error('not hatch');
    const vs = hatch.loops[0]?.vertices ?? [];
    const first = vs[0];
    const last = vs[vs.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // 마지막 arc 정점이 line 시작점(-50,0)으로 되돌아온다
    if (first && last) {
      expect(Math.hypot(last.p.x - -50, last.p.y - 0)).toBeLessThan(1);
    }
  });
});

describe('parseHatchEntities — 페이퍼 스페이스 HATCH 제외', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-paper.dxf'));

  it('모델 HATCH만 남고 페이퍼 스페이스(67=1)는 제외', () => {
    const hatches = model.entities.filter((e) => e.kind === 'hatch');
    expect(hatches).toHaveLength(1);
    expect(hatches[0]?.handle).toBe('HM');
  });

  it('paperSpaceExcludedCount로 제외 수 집계 (조용히 버리지 않음)', () => {
    expect(model.paperSpaceExcludedCount).toBe(1);
  });

  it('bounds가 도곽(841×594)이 아니라 모델(10×10) 규모', () => {
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('직접 파서 결과 — modelHatches 1, paperSpaceExcludedCount 1, 실패 0', () => {
    const r = parseHatchEntities(readFixture('synthetic-hatch-paper.dxf'));
    expect(r.modelHatches).toHaveLength(1);
    expect(r.paperSpaceExcludedCount).toBe(1);
    expect(r.failedCount).toBe(0);
    expect(r.hatchesByBlock.size).toBe(0);
  });
});

describe('parseHatchEntities — 블록 정의 HATCH의 INSERT 전개', () => {
  const model = parseAndNormalizeDxf(readFixture('synthetic-hatch-block.dxf'));
  const hatches = model.entities.filter((e) => e.kind === 'hatch');

  it('블록에 HATCH 1개, INSERT 2회 → world HATCH 2개', () => {
    expect(hatches).toHaveLength(2);
  });

  it('각 인스턴스가 INSERT 위치로 변환됨 (0,0)과 (100,0)', () => {
    const xs = hatches
      .map((h) => (h.kind === 'hatch' ? (h.loops[0]?.vertices[0]?.p.x ?? Number.NaN) : Number.NaN))
      .sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 9);
    expect(xs[1]).toBeCloseTo(100, 9);
  });

  it('전개 출처(origin.blockPath)에 블록명 보존, 면적 100', () => {
    for (const h of hatches) {
      if (h.kind !== 'hatch') continue;
      expect(h.origin?.blockPath).toEqual(['HB']);
      expect(hatchArea(h.loops)).toBeCloseTo(100, 9);
    }
  });

  it('직접 파서 결과 — hatchesByBlock에 블록명 키', () => {
    const r = parseHatchEntities(readFixture('synthetic-hatch-block.dxf'));
    expect(r.hatchesByBlock.get('HB')).toHaveLength(1);
    expect(r.modelHatches).toHaveLength(0);
    expect(r.failedCount).toBe(0);
  });
});
