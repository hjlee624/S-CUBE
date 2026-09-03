/**
 * RW-14: 레이어 규칙 — 레이어 패턴 매핑 + 일괄 항목 후보 (P5-7~9)
 *
 * 역할:
 * - LayerRule 패턴(glob)으로 엔티티를 그룹핑해 항목 후보를 반환한다.
 * - 레이어 규칙이 없어도 앱의 모든 기능이 동작한다(보조 가속 수단, R-9).
 * - 사용자는 반환된 후보를 승인/거부한다 (자동 확정 금지, P5-9).
 */
import type { LayerRule } from '@s-cube/schema';
import type { NEntity } from '@s-cube/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Glob 패턴 매핑
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 글로브 패턴 매칭 — `*`(0개 이상 문자), `?`(정확히 1개 문자), 대소문자 무시.
 *
 * 전체 문자열 매칭(^ … $)이므로 부분 일치는 반환하지 않는다.
 */
export function globMatch(pattern: string, text: string): boolean {
  // 정규식 특수문자 이스케이프 (* ? 제외)
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i').test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// 규칙 매칭 + 일괄 후보
// ─────────────────────────────────────────────────────────────────────────────

/** 규칙 하나에 매칭된 엔티티 그룹 */
export interface LayerRuleMatch {
  rule: LayerRule;
  /** 매칭된 레이어 이름 목록 (규칙이 여러 레이어에 걸칠 수 있음) */
  matchedLayers: string[];
  /** 매칭된 엔티티 목록 */
  entities: NEntity[];
}

/**
 * 규칙 목록을 엔티티 배열에 적용해 매칭 결과를 반환한다 (P5-7/9).
 *
 * - 규칙 순서대로 우선 적용한다 (첫 번째 매칭 규칙이 우선).
 * - text·dimension 엔티티는 기하 측정 대상이 아니므로 매칭에서 제외한다.
 * - 규칙에 해당하지 않는 엔티티는 결과에 포함되지 않는다.
 *
 * @param entities  도면 엔티티 배열
 * @param rules     LayerRule 배열 (순서가 우선순위)
 * @returns 규칙별 매칭 결과 (엔티티 0개인 규칙은 제외)
 */
export function matchLayerRules(
  entities: readonly NEntity[],
  rules: readonly LayerRule[],
): LayerRuleMatch[] {
  if (rules.length === 0) return [];

  // 기하 엔티티만 대상
  const geoEntities = entities.filter((e) => e.kind !== 'text' && e.kind !== 'dimension');

  // 규칙 인덱스별 매칭 집계
  const matchMap = new Map<number, { layers: Set<string>; entities: NEntity[] }>();
  for (let ri = 0; ri < rules.length; ri++) {
    matchMap.set(ri, { layers: new Set(), entities: [] });
  }

  for (const entity of geoEntities) {
    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      if (rule === undefined) continue;
      if (globMatch(rule.pattern, entity.layer)) {
        const entry = matchMap.get(ri);
        if (entry === undefined) continue;
        entry.layers.add(entity.layer);
        entry.entities.push(entity);
        break; // 첫 번째 매칭 규칙만 적용 (우선순위)
      }
    }
  }

  // 결과 조합 (매칭 엔티티 없는 규칙은 제외)
  const results: LayerRuleMatch[] = [];
  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri];
    const entry = matchMap.get(ri);
    if (rule === undefined || entry === undefined || entry.entities.length === 0) continue;
    results.push({
      rule,
      matchedLayers: [...entry.layers].sort(),
      entities: entry.entities,
    });
  }

  return results;
}

/**
 * 규칙 매칭 결과를 사용자 승인 후보 형태로 변환한다 (P5-9).
 *
 * 반환값: 각 후보는 규칙·레이어·엔티티 수·제안 라벨을 포함한다.
 * UI는 이를 리스트로 표시하고 사용자가 개별 승인/거부를 선택한다.
 */
export interface LayerRuleCandidate {
  ruleId: string;
  calcType: LayerRule['calcType'];
  specCode: string | undefined;
  /** 항목 라벨 제안 (rule.label ?? 첫 번째 matchedLayer) */
  suggestedLabel: string;
  matchedLayers: string[];
  entityCount: number;
  entities: NEntity[];
}

export function buildRuleCandidates(matches: LayerRuleMatch[]): LayerRuleCandidate[] {
  return matches.map((m) => ({
    ruleId: m.rule.id,
    calcType: m.rule.calcType,
    specCode: m.rule.specCode,
    suggestedLabel: m.rule.label ?? m.matchedLayers[0] ?? m.rule.pattern,
    matchedLayers: m.matchedLayers,
    entityCount: m.entities.length,
    entities: m.entities,
  }));
}
