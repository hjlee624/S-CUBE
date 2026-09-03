/**
 * RW-12: 객체 기반 후보 그룹핑 (P5-7c/7d)
 *
 * 도면 엔티티를 레이어·색상 유사도로 그룹핑하고,
 * 수평 X 오버랩이 충분한 그룹 쌍을 원지반/계획선 후보로 반환한다.
 *
 * 사용 흐름:
 *   1. groupBySimilarity(entities) → EntityGroup[]
 *   2. detectSectionPairs(groups) → SectionPairCandidate[]
 *   3. 사용자가 후보를 승인해 원지반/계획선을 배정
 */
import { entityBounds, mergeBounds } from './bounds.ts';
import type { Bounds, NEntity } from '@s-cube/schema';

// ─────────────────────────────────────────────────────────────────────────────
// 1. 유사도 그룹핑
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityGroup {
  /** layer + ":" + colorIndex 복합 키 */
  key: string;
  layer: string;
  /** 해석된 ACI 색인 — 256=BYLAYER(기본), 0=BYBLOCK */
  colorIndex: number;
  entities: NEntity[];
  /** 그룹 전체 바운딩 박스 */
  bounds: Bounds;
}

/** ACI 색인을 해석한다. undefined → BYLAYER(256) */
function resolvedColor(e: NEntity): number {
  return e.colorIndex ?? 256;
}

function groupKey(layer: string, colorIndex: number): string {
  return `${layer}:${colorIndex}`;
}

/**
 * 기하 엔티티(line·polyline·arc·circle·hatch)를 레이어·색상 조합으로 그룹핑한다.
 * text·dimension 은 제목/치수이므로 그룹핑에서 제외한다.
 *
 * @returns 엔티티 수 내림차순으로 정렬된 그룹 목록
 */
export function groupBySimilarity(entities: readonly NEntity[]): EntityGroup[] {
  const map = new Map<string, { layer: string; colorIndex: number; entities: NEntity[] }>();

  for (const e of entities) {
    if (e.kind === 'text' || e.kind === 'dimension') continue;
    const ci = resolvedColor(e);
    const key = groupKey(e.layer, ci);
    const entry = map.get(key);
    if (entry === undefined) {
      map.set(key, { layer: e.layer, colorIndex: ci, entities: [e] });
    } else {
      entry.entities.push(e);
    }
  }

  const groups: EntityGroup[] = [];
  for (const [key, { layer, colorIndex, entities }] of map) {
    const bounds = mergeBounds(entities.map((e) => entityBounds(e)));
    if (bounds === null) continue;
    groups.push({ key, layer, colorIndex, entities, bounds });
  }

  return groups.sort((a, b) => b.entities.length - a.entities.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 원지반/계획선 쌍 탐색
// ─────────────────────────────────────────────────────────────────────────────

/** 단면 프로파일 — 수평 연장이 충분한 그룹의 파생 정보 */
export interface SectionProfile {
  group: EntityGroup;
  /** Y 무게중심 — 두 프로파일의 위/아래 판정에 사용 */
  centroidY: number;
  xMin: number;
  xMax: number;
  xSpan: number;
}

/** 원지반/계획선 쌍 후보 */
export interface SectionPairCandidate {
  /** 상단 프로파일 (centroidY 더 큰 쪽) */
  upper: SectionProfile;
  /** 하단 프로파일 */
  lower: SectionProfile;
  /** X 오버랩 비율 (0–1) — 짧은 쪽 기준 */
  xOverlapRatio: number;
  /** 두 centroidY 의 절대 차이 (도면 단위) */
  verticalGap: number;
}

/**
 * 두 프로파일의 X 오버랩 비율을 계산한다.
 * 짧은 쪽(xSpan 더 작은 프로파일)을 기준으로 정규화한다.
 */
function xOverlapRatio(a: SectionProfile, b: SectionProfile): number {
  const lo = Math.max(a.xMin, b.xMin);
  const hi = Math.min(a.xMax, b.xMax);
  if (lo >= hi) return 0;
  const overlap = hi - lo;
  const shorter = Math.min(a.xSpan, b.xSpan);
  return shorter > 0 ? overlap / shorter : 0;
}

/**
 * 그룹 목록에서 원지반/계획선 쌍 후보를 탐색한다.
 *
 * 조건:
 * - 그룹의 X 연장이 Y 연장보다 커야 한다(수평 프로파일).
 * - 두 그룹의 X 오버랩 비율이 `minXOverlapRatio` 이상이어야 한다.
 *
 * @param groups groupBySimilarity() 반환값
 * @param minXOverlapRatio 최소 X 오버랩 비율 (기본값 0.5)
 * @returns X 오버랩 비율 내림차순, 동률 시 수직 간격 오름차순 정렬
 */
export function detectSectionPairs(
  groups: EntityGroup[],
  minXOverlapRatio = 0.5,
): SectionPairCandidate[] {
  const profiles: SectionProfile[] = groups
    .filter((g) => {
      const xSpan = g.bounds.maxX - g.bounds.minX;
      const ySpan = g.bounds.maxY - g.bounds.minY;
      return xSpan > 0 && xSpan > ySpan; // 가로로 긴 프로파일만
    })
    .map((g) => ({
      group: g,
      centroidY: (g.bounds.minY + g.bounds.maxY) / 2,
      xMin: g.bounds.minX,
      xMax: g.bounds.maxX,
      xSpan: g.bounds.maxX - g.bounds.minX,
    }));

  const candidates: SectionPairCandidate[] = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i] as SectionProfile;
      const b = profiles[j] as SectionProfile;
      const ratio = xOverlapRatio(a, b);
      if (ratio < minXOverlapRatio) continue;
      const upper = a.centroidY >= b.centroidY ? a : b;
      const lower = a.centroidY < b.centroidY ? a : b;
      candidates.push({
        upper,
        lower,
        xOverlapRatio: ratio,
        verticalGap: Math.abs(a.centroidY - b.centroidY),
      });
    }
  }

  return candidates.sort(
    (a, b) => b.xOverlapRatio - a.xOverlapRatio || a.verticalGap - b.verticalGap,
  );
}
