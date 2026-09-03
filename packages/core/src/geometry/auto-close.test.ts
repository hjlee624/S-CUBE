import { describe, expect, it } from 'vitest';
import { autoCloseEntities, buildSnapGraph, findClosedFaces } from './auto-close.ts';
import type { NEntity } from '@s-cube/schema';

// 헬퍼: 가로·세로 정렬 직사각형을 4개의 LINE 엔티티로 만든다
function makeRect(
  x: number,
  y: number,
  w: number,
  h: number,
  baseHandle = 'R',
): NEntity[] {
  return [
    {
      kind: 'line',
      handle: `${baseHandle}0`,
      layer: '0',
      a: { x, y },
      b: { x: x + w, y },
    },
    {
      kind: 'line',
      handle: `${baseHandle}1`,
      layer: '0',
      a: { x: x + w, y },
      b: { x: x + w, y: y + h },
    },
    {
      kind: 'line',
      handle: `${baseHandle}2`,
      layer: '0',
      a: { x: x + w, y: y + h },
      b: { x, y: y + h },
    },
    {
      kind: 'line',
      handle: `${baseHandle}3`,
      layer: '0',
      a: { x, y: y + h },
      b: { x, y },
    },
  ];
}

// 헬퍼: 삼각형 (3개 LINE)
function makeTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  baseHandle = 'T',
): NEntity[] {
  return [
    {
      kind: 'line',
      handle: `${baseHandle}0`,
      layer: '0',
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
    },
    {
      kind: 'line',
      handle: `${baseHandle}1`,
      layer: '0',
      a: { x: bx, y: by },
      b: { x: cx, y: cy },
    },
    {
      kind: 'line',
      handle: `${baseHandle}2`,
      layer: '0',
      a: { x: cx, y: cy },
      b: { x: ax, y: ay },
    },
  ];
}

const SNAP = 0.01; // 1 cm

describe('buildSnapGraph — 노드·간선 위상 구성 (RW-11)', () => {
  it('빈 엔티티 → 노드·간선 없음', () => {
    const g = buildSnapGraph([], SNAP);
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it('단일 LINE → 노드 2, 간선 1', () => {
    const line: NEntity = {
      kind: 'line',
      handle: 'L0',
      layer: '0',
      a: { x: 0, y: 0 },
      b: { x: 10, y: 0 },
    };
    const g = buildSnapGraph([line], SNAP);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });

  it('2개의 LINE 끝점이 snap 거리 이내 → 공유 노드 병합', () => {
    // L1: (0,0)→(10,0), L2: (10,0)→(10,10) — 공유점 (10,0)
    const entities: NEntity[] = [
      { kind: 'line', handle: 'L1', layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', handle: 'L2', layer: '0', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
    ];
    const g = buildSnapGraph(entities, SNAP);
    // 고유 끝점: (0,0), (10,0), (10,10) = 3개
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
  });

  it('snap tolerance 이내 미세 오차 → 노드 병합', () => {
    // (10,0)과 (10.005, 0) — 거리 0.005 < SNAP(0.01) → 같은 노드
    const entities: NEntity[] = [
      { kind: 'line', handle: 'L1', layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      {
        kind: 'line',
        handle: 'L2',
        layer: '0',
        a: { x: 10.005, y: 0 },
        b: { x: 10, y: 10 },
      },
    ];
    const g = buildSnapGraph(entities, SNAP);
    expect(g.nodes).toHaveLength(3); // 병합으로 3개
  });

  it('직사각형 4선 → 노드 4, 간선 4', () => {
    const g = buildSnapGraph(makeRect(0, 0, 100, 50), SNAP);
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(4);
  });
});

describe('findClosedFaces — 폐합 face 탐색 (RW-11)', () => {
  it('삼각형 3선 → 폐합 face 1개', () => {
    const entities = makeTriangle(0, 0, 10, 0, 5, 8, 'T');
    const g = buildSnapGraph(entities, SNAP);
    const faces = findClosedFaces(g);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.vertices).toHaveLength(3);
    expect(faces[0]?.areaRaw).toBeGreaterThan(0);
    expect(faces[0]?.handles).toEqual(expect.arrayContaining(['T0', 'T1', 'T2']));
  });

  it('직사각형 4선 → 폐합 face 1개, 면적 = w×h', () => {
    const W = 100;
    const H = 50;
    const entities = makeRect(0, 0, W, H);
    const g = buildSnapGraph(entities, SNAP);
    const faces = findClosedFaces(g);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.areaRaw).toBeCloseTo(W * H, 6);
  });

  it('노드가 부족하면 빈 배열 반환', () => {
    // 선분 2개 — 폐합 불가
    const entities: NEntity[] = [
      { kind: 'line', handle: 'L0', layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', handle: 'L1', layer: '0', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
    ];
    const g = buildSnapGraph(entities, SNAP);
    const faces = findClosedFaces(g);
    expect(faces).toHaveLength(0);
  });

  it('두 인접 직사각형(공유 변) → face 3개 (작은 두 직사각형 + 전체)', () => {
    // 좌 사각형 (0,0)-(50,50), 우 사각형 (50,0)-(100,50), 공유 변 x=50
    const left = makeRect(0, 0, 50, 50, 'L');
    const right = makeRect(50, 0, 50, 50, 'R');
    const entities = [...left, ...right];
    const g = buildSnapGraph(entities, SNAP);
    const faces = findClosedFaces(g);
    // 최소 2개(각 사각형) 이상 탐색돼야 함
    expect(faces.length).toBeGreaterThanOrEqual(2);
    const areas = faces.map((f) => f.areaRaw).sort((a, b) => a - b);
    // 작은 두 사각형은 50×50 = 2500
    expect(areas[0]).toBeCloseTo(2500, 3);
    expect(areas[1]).toBeCloseTo(2500, 3);
  });
});

describe('autoCloseEntities — 통합 API (RW-11)', () => {
  it('삼각형 → 폐합 후보 반환', () => {
    const entities = makeTriangle(0, 0, 6, 0, 3, 4, 'T');
    const faces = autoCloseEntities(entities, SNAP);
    expect(faces).toHaveLength(1);
    // 3-4-5 직각삼각형: 면적 = 6×4/2 = 12
    expect(faces[0]?.areaRaw).toBeCloseTo(12, 5);
  });

  it('열린 선분(2개 LINE) — snap 연결 불가 → 폐합 없음', () => {
    const entities: NEntity[] = [
      { kind: 'line', handle: 'L0', layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', handle: 'L1', layer: '0', a: { x: 20, y: 0 }, b: { x: 30, y: 0 } },
    ];
    const faces = autoCloseEntities(entities, SNAP);
    expect(faces).toHaveLength(0);
  });

  it('snap tolerance 내 미세 갭 자동 연결 → 삼각형 폐합', () => {
    // 각 꼭짓점에 0.005 오차를 주어 연속성이 완벽하지 않은 도형
    const entities: NEntity[] = [
      {
        kind: 'line',
        handle: 'A',
        layer: '0',
        a: { x: 0, y: 0 },
        b: { x: 10.003, y: 0 }, // 오차
      },
      {
        kind: 'line',
        handle: 'B',
        layer: '0',
        a: { x: 10, y: 0.002 }, // 오차
        b: { x: 5, y: 8 },
      },
      {
        kind: 'line',
        handle: 'C',
        layer: '0',
        a: { x: 5.004, y: 8 }, // 오차
        b: { x: 0.001, y: 0.003 }, // 오차
      },
    ];
    const faces = autoCloseEntities(entities, SNAP);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.areaRaw).toBeGreaterThan(0);
  });

  it('결과는 면적 오름차순 정렬', () => {
    // 큰 삼각형 + 작은 삼각형 (분리된 두 삼각형)
    const big = makeTriangle(0, 0, 100, 0, 50, 100, 'B');
    const small = makeTriangle(200, 0, 210, 0, 205, 8, 'S');
    const faces = autoCloseEntities([...big, ...small], SNAP);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < faces.length; i++) {
      expect((faces[i]?.areaRaw ?? 0)).toBeGreaterThanOrEqual(faces[i - 1]?.areaRaw ?? 0);
    }
  });
});
