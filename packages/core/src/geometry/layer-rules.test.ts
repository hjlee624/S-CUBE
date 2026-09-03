import { describe, expect, it } from 'vitest';
import type { LayerRule } from '@s-cube/schema';
import {
  buildRuleCandidates,
  globMatch,
  matchLayerRules,
} from './layer-rules.ts';
import type { NEntity } from '@s-cube/schema';

// 헬퍼
function line(handle: string, layer: string): NEntity {
  return { kind: 'line', handle, layer, a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
}
function text(handle: string, layer: string): NEntity {
  return { kind: 'text', handle, layer, pos: { x: 0, y: 0 }, value: 'T', height: 1 };
}
function rule(overrides: Partial<LayerRule> & { pattern: string; calcType: LayerRule['calcType'] }): LayerRule {
  return { id: overrides.id ?? 'r1', ...overrides };
}

describe('globMatch (RW-14)', () => {
  it('정확한 문자열 매칭 (대소문자 무시)', () => {
    expect(globMatch('CUT-AREA', 'CUT-AREA')).toBe(true);
    expect(globMatch('CUT-AREA', 'cut-area')).toBe(true);
    expect(globMatch('CUT-AREA', 'FILL-AREA')).toBe(false);
  });

  it('* 와일드카드 — 0개 이상 문자 매칭', () => {
    expect(globMatch('CUT-*', 'CUT-AREA')).toBe(true);
    expect(globMatch('CUT-*', 'CUT-')).toBe(true);
    expect(globMatch('CUT-*', 'FILL-AREA')).toBe(false);
    expect(globMatch('*AREA*', 'CUT-AREA-1')).toBe(true);
  });

  it('? 와일드카드 — 정확히 1개 문자', () => {
    expect(globMatch('CUT-?', 'CUT-A')).toBe(true);
    expect(globMatch('CUT-?', 'CUT-AB')).toBe(false);
    expect(globMatch('CUT-?', 'CUT-')).toBe(false);
  });

  it('정규식 특수문자 리터럴 취급', () => {
    expect(globMatch('ROAD.CENTER', 'ROAD.CENTER')).toBe(true);
    expect(globMatch('ROAD.CENTER', 'ROAD-CENTER')).toBe(false);
    expect(globMatch('(LAYER)', '(LAYER)')).toBe(true);
  });

  it('빈 패턴은 빈 문자열에만 매칭', () => {
    expect(globMatch('', '')).toBe(true);
    expect(globMatch('', 'A')).toBe(false);
  });

  it('전체 와일드카드(*) 는 모든 문자열에 매칭', () => {
    expect(globMatch('*', '')).toBe(true);
    expect(globMatch('*', 'ANY-LAYER')).toBe(true);
  });
});

describe('matchLayerRules (RW-14)', () => {
  it('빈 규칙 → 빈 결과', () => {
    expect(matchLayerRules([line('L1', 'CUT')], [])).toHaveLength(0);
  });

  it('빈 엔티티 → 빈 결과', () => {
    const rules = [rule({ pattern: 'CUT', calcType: 'area' })];
    expect(matchLayerRules([], rules)).toHaveLength(0);
  });

  it('패턴 매칭 — 단일 규칙, 단일 레이어', () => {
    const entities = [line('L1', 'CUT-AREA'), line('L2', 'FILL-AREA')];
    const rules = [rule({ id: 'r-cut', pattern: 'CUT-*', calcType: 'area' })];
    const matches = matchLayerRules(entities, rules);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rule.id).toBe('r-cut');
    expect(matches[0]?.entities).toHaveLength(1);
    expect(matches[0]?.matchedLayers).toEqual(['CUT-AREA']);
  });

  it('다중 규칙 — 각 엔티티는 첫 번째 매칭 규칙에만 할당됨', () => {
    const entities = [line('L1', 'ROAD'), line('L2', 'ROAD')];
    const rules = [
      rule({ id: 'r1', pattern: 'ROAD', calcType: 'area' }),
      rule({ id: 'r2', pattern: 'R*', calcType: 'length' }), // 더 넓은 패턴이지만 두 번째
    ];
    const matches = matchLayerRules(entities, rules);
    // ROAD 는 r1 에만 할당되고 r2 에는 매칭 없음 (우선순위)
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rule.id).toBe('r1');
    expect(matches[0]?.entities).toHaveLength(2);
  });

  it('text/dimension 엔티티는 매칭에서 제외', () => {
    const entities: NEntity[] = [
      line('L1', 'CUT'),
      text('T1', 'CUT'), // text는 제외
      { kind: 'dimension', handle: 'D1', layer: 'CUT', defPoints: [], measuredRaw: 5, textOverride: null },
    ];
    const rules = [rule({ pattern: 'CUT', calcType: 'area' })];
    const matches = matchLayerRules(entities, rules);
    // line(1개)만 포함
    expect(matches[0]?.entities).toHaveLength(1);
    expect(matches[0]?.entities[0]?.kind).toBe('line');
  });

  it('matchedLayers — 규칙 하나가 여러 레이어에 걸침', () => {
    const entities = [
      line('L1', 'CUT-LEFT'),
      line('L2', 'CUT-RIGHT'),
      line('L3', 'CUT-CENTER'),
    ];
    const rules = [rule({ pattern: 'CUT-*', calcType: 'area' })];
    const matches = matchLayerRules(entities, rules);
    expect(matches[0]?.matchedLayers.sort()).toEqual(['CUT-CENTER', 'CUT-LEFT', 'CUT-RIGHT']);
    expect(matches[0]?.entities).toHaveLength(3);
  });

  it('매칭 엔티티 없는 규칙은 결과에서 제외', () => {
    const entities = [line('L1', 'FILL')];
    const rules = [
      rule({ id: 'r-cut', pattern: 'CUT-*', calcType: 'area' }),
      rule({ id: 'r-fill', pattern: 'FILL', calcType: 'area' }),
    ];
    const matches = matchLayerRules(entities, rules);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.rule.id).toBe('r-fill');
  });
});

describe('buildRuleCandidates (RW-14)', () => {
  it('rule.label 있으면 suggestedLabel에 사용', () => {
    const entities = [line('L1', 'CUT-A')];
    const rules = [rule({ id: 'r1', pattern: 'CUT-*', calcType: 'area', label: '절토면' })];
    const matches = matchLayerRules(entities, rules);
    const candidates = buildRuleCandidates(matches);
    expect(candidates[0]?.suggestedLabel).toBe('절토면');
  });

  it('rule.label 없으면 첫 번째 matchedLayer 사용', () => {
    const entities = [line('L1', 'FILL-ZONE')];
    const rules = [rule({ id: 'r1', pattern: 'FILL-*', calcType: 'area' })];
    const matches = matchLayerRules(entities, rules);
    const candidates = buildRuleCandidates(matches);
    expect(candidates[0]?.suggestedLabel).toBe('FILL-ZONE');
  });

  it('entityCount 정확히 카운트', () => {
    const entities = [line('L1', 'ROAD'), line('L2', 'ROAD'), line('L3', 'ROAD')];
    const rules = [rule({ id: 'r1', pattern: 'ROAD', calcType: 'length' })];
    const matches = matchLayerRules(entities, rules);
    const candidates = buildRuleCandidates(matches);
    expect(candidates[0]?.entityCount).toBe(3);
  });

  it('specCode 전달', () => {
    const entities = [line('L1', 'CONC')];
    const rules = [rule({ id: 'r1', pattern: 'CONC', calcType: 'area-thickness', specCode: 'C-001' })];
    const matches = matchLayerRules(entities, rules);
    const candidates = buildRuleCandidates(matches);
    expect(candidates[0]?.specCode).toBe('C-001');
  });
});
