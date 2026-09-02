/**
 * P1-2 (조용히 버리지 않기): DWG→DXF 변환 손실로 생긴 "고아 블록" 감지.
 *
 * LibreDWG 등 일부 변환기는 설계 블록을 모델 공간에 배치하는 top-level INSERT를
 * 잃어버린다. 결과: 블록 정의(BLOCKS 섹션)는 남지만, 어떤 top-level INSERT로도
 * 도달할 수 없어 렌더·측정 대상에서 통째로 빠지는 블록이 생긴다. 이 블록들은 로컬
 * 좌표(0 근처)로 정의되어 있어 배치 INSERT 없이는 올바른 위치에 그릴 수 없다 —
 * 우리가 만들 수 없는 지오메트리다.
 *
 * 대응: 손실 규모(도달 불가 대형 블록의 엔티티 총합)를 추정해 사용자에게 경고할 수
 * 있도록 수치를 집계한다. 조용히 버리지 않는다.
 *
 * 알고리즘:
 *  1. 모델 공간 top-level INSERT/DIMENSION이 참조하는 블록명에서 BFS로 도달 가능한 블록
 *     집합을 구한다(블록 내부 INSERT와 DIMENSION 치수블록을 재귀적으로 따라가며 —
 *     expand.ts가 실제로 전개하는 그대로 —, 순환은 visited로 차단).
 *  2. 정의됐지만 도달 불가한 블록 중, 엔티티 수가 MIN_ORPHAN_ENTITIES 이상인 것들의
 *     엔티티 수를 합산한다(각 블록 1회만 — 고아끼리 참조해도 중복 없음).
 *  3. *Model_Space / *Paper_Space 시스템 블록은 제외한다. 익명 블록(A$C..., *U... 등)은
 *     실제 설계일 수 있으므로 엔티티 수 임계로만 판단하고 제외하지 않는다.
 */
import type { RawBlock, RawDimensionEntity, RawEntityBase, RawInsertEntity } from './raw-types.ts';

/**
 * 고아로 집계할 최소 엔티티 수. 이보다 작은 미참조 블록은 정의만 남은 잔여물(빈 블록,
 * 사용 안 된 소형 심볼 등)일 가능성이 높아 손실 규모에서 무시한다.
 */
export const MIN_ORPHAN_ENTITIES = 50;

/**
 * 모델 공간·페이퍼 스페이스 컨테이너 블록명(대소문자 무시). 이들은 top-level 엔티티의
 * 컨테이너이지 배치 대상 설계 블록이 아니므로 고아 판정에서 제외한다.
 */
const SYSTEM_SPACE_BLOCKS: ReadonlySet<string> = new Set([
  '*model_space',
  '*paper_space',
  '*paper_space0',
]);

function isSystemSpaceBlock(name: string): boolean {
  return SYSTEM_SPACE_BLOCKS.has(name.toLowerCase());
}

/**
 * 엔티티 목록이 참조하는 하위 블록명을 수집한다(이름 있는 것만).
 * expand.ts의 실제 전개 규칙과 일치시킨다:
 *  - INSERT.name (그룹코드 2) — walkEntities가 블록을 재귀 전개한다
 *  - DIMENSION.block (그룹코드 2) — expandDimensionBlock이 치수블록을 INSERT처럼 전개한다
 * 도달성 계산이 이 둘을 모두 따라가야 실제 렌더되는 치수 그림 블록을 고아로 오탐하지 않는다.
 */
export function collectReferencedBlockNames(entities: readonly RawEntityBase[]): string[] {
  const names: string[] = [];
  for (const e of entities) {
    if (e.type === 'INSERT') {
      const name = (e as RawInsertEntity).name;
      if (name !== undefined) names.push(name);
    } else if (e.type === 'DIMENSION') {
      const block = (e as RawDimensionEntity).block;
      if (block !== undefined) names.push(block);
    }
  }
  return names;
}

/**
 * top-level INSERT/DIMENSION 참조에서 BFS로 도달 가능한 블록명 집합을 계산한다.
 * 블록 내부 INSERT와 DIMENSION 치수블록을 재귀적으로 따라가며, 순환/중복 방문은
 * visited로 차단한다.
 */
function reachableBlocks(
  topLevelRefs: Iterable<string>,
  blocks: Readonly<Record<string, RawBlock>>,
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const name of topLevelRefs) {
    if (!visited.has(name)) {
      visited.add(name);
      queue.push(name);
    }
  }
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const block = blocks[name];
    if (block === undefined) continue;
    for (const child of collectReferencedBlockNames(block.entities ?? [])) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }
  return visited;
}

/**
 * 고아 블록(정의됐지만 top-level 참조로 도달 불가한 대형 블록)의 엔티티 총합을 계산한다.
 *
 * @param topLevelRefs 모델 공간(페이퍼 스페이스 제외) top-level INSERT.name·DIMENSION.block
 *   의 블록명 집합 (collectReferencedBlockNames로 수집)
 * @param blocks BLOCKS 섹션의 블록 정의 (name → RawBlock)
 * @returns 고아 블록들의 엔티티 수 합계(대략적 손실 규모). 고아 없으면 0.
 */
export function computeOrphanedBlockEntityCount(
  topLevelRefs: Iterable<string>,
  blocks: Readonly<Record<string, RawBlock>>,
): number {
  const reachable = reachableBlocks(topLevelRefs, blocks);
  let orphanedEntityCount = 0;
  for (const [key, block] of Object.entries(blocks)) {
    const name = block.name ?? key;
    if (isSystemSpaceBlock(name)) continue;
    // 도달 가능하면 고아가 아니다. 블록 키·이름 어느 쪽으로든 도달됐으면 제외.
    if (reachable.has(name) || reachable.has(key)) continue;
    const entityCount = block.entities?.length ?? 0;
    if (entityCount >= MIN_ORPHAN_ENTITIES) {
      orphanedEntityCount += entityCount;
    }
  }
  return orphanedEntityCount;
}
