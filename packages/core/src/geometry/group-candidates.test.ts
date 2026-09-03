import { describe, expect, it } from 'vitest';
import { detectSectionPairs, groupBySimilarity } from './group-candidates.ts';
import type { NEntity } from '@s-cube/schema';

// 헬퍼: 수평 LINE 엔티티 생성
function hline(
  handle: string,
  layer: string,
  x0: number,
  x1: number,
  y: number,
  colorIndex?: number,
): NEntity {
  return {
    kind: 'line',
    handle,
    layer,
    colorIndex,
    a: { x: x0, y },
    b: { x: x1, y },
  };
}

// 헬퍼: 수직 LINE (bounds 계산에서 xSpan < ySpan)
function vline(handle: string, layer: string, x: number, y0: number, y1: number): NEntity {
  return {
    kind: 'line',
    handle,
    layer,
    a: { x, y: y0 },
    b: { x, y: y1 },
  };
}

describe('groupBySimilarity (RW-12)', () => {
  it('빈 배열 → 빈 그룹', () => {
    expect(groupBySimilarity([])).toHaveLength(0);
  });

  it('text/dimension 엔티티는 그룹에서 제외', () => {
    const entities: NEntity[] = [
      { kind: 'text', handle: 'T1', layer: 'TEXT', pos: { x: 0, y: 0 }, value: 'STA', height: 2 },
      { kind: 'dimension', handle: 'D1', layer: 'DIM', defPoints: [], measuredRaw: 5, textOverride: null },
    ];
    expect(groupBySimilarity(entities)).toHaveLength(0);
  });

  it('같은 레이어·색상 → 하나의 그룹', () => {
    const entities: NEntity[] = [
      hline('L1', 'ROAD', 0, 100, 10),
      hline('L2', 'ROAD', 0, 100, 12),
    ];
    const groups = groupBySimilarity(entities);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entities).toHaveLength(2);
    expect(groups[0]?.layer).toBe('ROAD');
  });

  it('다른 레이어 → 별도 그룹', () => {
    const entities: NEntity[] = [
      hline('L1', 'ROAD', 0, 100, 10),
      hline('L2', 'PLAN', 0, 100, 5),
    ];
    const groups = groupBySimilarity(entities);
    expect(groups).toHaveLength(2);
  });

  it('같은 레이어·다른 색상 → 별도 그룹', () => {
    const entities: NEntity[] = [
      hline('L1', 'ROAD', 0, 100, 10, 1),  // 빨강
      hline('L2', 'ROAD', 0, 100, 5, 3),   // 초록
    ];
    const groups = groupBySimilarity(entities);
    expect(groups).toHaveLength(2);
  });

  it('colorIndex 미설정 → BYLAYER(256)로 처리해 같은 그룹', () => {
    const entities: NEntity[] = [
      hline('L1', 'ROAD', 0, 100, 10),        // undefined → 256
      hline('L2', 'ROAD', 0, 100, 12, 256),   // 명시적 256
    ];
    const groups = groupBySimilarity(entities);
    expect(groups).toHaveLength(1);
  });

  it('bounds — 그룹 바운딩 박스가 모든 멤버를 포함', () => {
    const entities: NEntity[] = [
      hline('L1', 'ROAD', 0, 50, 10),
      hline('L2', 'ROAD', 30, 100, 10),
    ];
    const groups = groupBySimilarity(entities);
    expect(groups[0]?.bounds.minX).toBeCloseTo(0);
    expect(groups[0]?.bounds.maxX).toBeCloseTo(100);
  });

  it('결과는 엔티티 수 내림차순 정렬', () => {
    const entities: NEntity[] = [
      hline('A1', 'A', 0, 100, 10),
      hline('B1', 'B', 0, 100, 5),
      hline('B2', 'B', 0, 100, 6),
      hline('B3', 'B', 0, 100, 7),
    ];
    const groups = groupBySimilarity(entities);
    // layer B 는 3개, A는 1개 → B가 먼저
    expect(groups[0]?.layer).toBe('B');
    expect(groups[1]?.layer).toBe('A');
  });
});

describe('detectSectionPairs (RW-12)', () => {
  it('수평 그룹이 없으면 후보 없음', () => {
    // 수직 선만
    const entities: NEntity[] = [
      vline('V1', 'ROAD', 50, 0, 100),
      vline('V2', 'PLAN', 50, 0, 80),
    ];
    const groups = groupBySimilarity(entities);
    const pairs = detectSectionPairs(groups);
    expect(pairs).toHaveLength(0);
  });

  it('X 오버랩 충분한 두 수평 그룹 → 쌍 1개', () => {
    // 원지반선: y=20, 계획선: y=10 — X 범위 동일 (0~100)
    const entities: NEntity[] = [
      hline('G1', 'GROUND', 0, 100, 20), // 원지반
      hline('P1', 'PLAN', 0, 100, 10),   // 계획선
    ];
    const groups = groupBySimilarity(entities);
    const pairs = detectSectionPairs(groups);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.upper.group.layer).toBe('GROUND'); // centroidY 더 큰 쪽
    expect(pairs[0]?.lower.group.layer).toBe('PLAN');
    expect(pairs[0]?.xOverlapRatio).toBeCloseTo(1.0, 5);
    expect(pairs[0]?.verticalGap).toBeCloseTo(10, 5);
  });

  it('X 오버랩 50% 미만 → 후보 없음', () => {
    const entities: NEntity[] = [
      hline('G1', 'GROUND', 0, 40, 20),  // X: 0~40
      hline('P1', 'PLAN', 60, 100, 10),  // X: 60~100 → 오버랩 없음
    ];
    const groups = groupBySimilarity(entities);
    const pairs = detectSectionPairs(groups);
    expect(pairs).toHaveLength(0);
  });

  it('partial X 오버랩 ≥ 0.5 → 쌍 탐색', () => {
    // G: 0~100, P: 40~120 → 오버랩 60/80=0.75 (짧은 쪽 G 기준: 60/100=0.6)
    const entities: NEntity[] = [
      hline('G1', 'GROUND', 0, 100, 20),
      hline('P1', 'PLAN', 40, 120, 10),
    ];
    const groups = groupBySimilarity(entities);
    const pairs = detectSectionPairs(groups, 0.5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.xOverlapRatio).toBeGreaterThanOrEqual(0.5);
  });

  it('복수 후보 — X 오버랩 내림차순 정렬', () => {
    // G: 0~100, A: 0~100, B: 20~80 (부분 오버랩)
    const entities: NEntity[] = [
      hline('G1', 'G', 0, 100, 30),
      hline('A1', 'A', 0, 100, 20),   // G와 오버랩 1.0
      hline('B1', 'B', 20, 80, 10),   // G와 오버랩 0.6, A와 0.6
    ];
    const groups = groupBySimilarity(entities);
    const pairs = detectSectionPairs(groups, 0.5);
    // 첫 번째 쌍은 오버랩 가장 높아야 함
    expect(pairs[0]?.xOverlapRatio).toBeGreaterThanOrEqual(
      pairs[pairs.length - 1]?.xOverlapRatio ?? 0,
    );
  });

  it('minXOverlapRatio 커스텀 값 적용', () => {
    const entities: NEntity[] = [
      hline('G1', 'G', 0, 100, 20),
      hline('P1', 'P', 60, 100, 10), // 오버랩: 40/40=1.0 짧은쪽 기준
    ];
    const groups = groupBySimilarity(entities);
    // ratio=1.0 이므로 minXOverlapRatio=0.9 이어도 통과
    expect(detectSectionPairs(groups, 0.9)).toHaveLength(1);
  });
});
