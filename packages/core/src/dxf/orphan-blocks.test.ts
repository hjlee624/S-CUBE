import { describe, expect, it } from 'vitest';
import {
  collectReferencedBlockNames,
  computeOrphanedBlockEntityCount,
  MIN_ORPHAN_ENTITIES,
} from './orphan-blocks.ts';
import type { RawBlock, RawDimensionEntity, RawEntityBase, RawInsertEntity } from './raw-types.ts';

/** LINE 엔티티 n개를 담은 블록 정의 헬퍼 */
function blockWithLines(name: string, lineCount: number, extra: RawEntityBase[] = []): RawBlock {
  const entities: RawEntityBase[] = [];
  for (let i = 0; i < lineCount; i++) {
    entities.push({ type: 'LINE', handle: `${name}-L${i}` });
  }
  entities.push(...extra);
  return { name, position: { x: 0, y: 0 }, entities };
}

/** INSERT 참조 엔티티 헬퍼 */
function insertRef(target: string): RawInsertEntity {
  return { type: 'INSERT', name: target };
}

/** DIMENSION 치수블록 참조 엔티티 헬퍼(그룹코드 2) */
function dimRef(target: string): RawDimensionEntity {
  return { type: 'DIMENSION', block: target };
}

describe('computeOrphanedBlockEntityCount', () => {
  it('(a) top-level insert→A→B 체인은 모두 도달 — 고아 아님(0)', () => {
    // A는 top-level에서 참조, A 내부가 B를 INSERT → B도 도달 가능.
    const blocks: Record<string, RawBlock> = {
      A: blockWithLines('A', 100, [insertRef('B')]),
      B: blockWithLines('B', 100),
    };
    expect(computeOrphanedBlockEntityCount(['A'], blocks)).toBe(0);
  });

  it('(b) 정의됐지만 미참조 대형 블록(엔티티 100)은 고아로 집계', () => {
    const blocks: Record<string, RawBlock> = {
      PLACED: blockWithLines('PLACED', 100),
      ORPHAN: blockWithLines('ORPHAN', 100),
    };
    // top-level은 PLACED만 배치 → ORPHAN은 도달 불가.
    expect(computeOrphanedBlockEntityCount(['PLACED'], blocks)).toBe(100);
  });

  it('(c) 미참조지만 작은 블록(<MIN)은 무시(0)', () => {
    const small = MIN_ORPHAN_ENTITIES - 1;
    const blocks: Record<string, RawBlock> = {
      SMALL: blockWithLines('SMALL', small),
    };
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(0);
  });

  it('(c2) 정확히 MIN 경계는 고아로 집계(≥ 임계)', () => {
    const blocks: Record<string, RawBlock> = {
      EXACT: blockWithLines('EXACT', MIN_ORPHAN_ENTITIES),
    };
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(MIN_ORPHAN_ENTITIES);
  });

  it('(d) 고아끼리 순환 참조해도 top 미도달이면 둘 다 고아 — 무한루프 없음', () => {
    // O1↔O2가 서로를 INSERT(순환)하지만 top-level에서 어느 쪽도 참조하지 않음.
    const blocks: Record<string, RawBlock> = {
      O1: blockWithLines('O1', 100, [insertRef('O2')]),
      O2: blockWithLines('O2', 100, [insertRef('O1')]),
    };
    // 각 블록 1회만 합산: 100 + 100 = 200 (엔티티에 INSERT ref는 LINE 아님 → length는 101이지만
    // entities.length 기준이므로 INSERT ref 1개 포함 = 101 each). length 기준으로 검증한다.
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(202);
  });

  it('(d2) top-level이 순환의 한 축을 참조하면 순환 전체가 도달 — 고아 아님', () => {
    const blocks: Record<string, RawBlock> = {
      O1: blockWithLines('O1', 100, [insertRef('O2')]),
      O2: blockWithLines('O2', 100, [insertRef('O1')]),
    };
    expect(computeOrphanedBlockEntityCount(['O1'], blocks)).toBe(0);
  });

  it('(e) *Model_Space / *Paper_Space 시스템 블록은 대형이어도 제외', () => {
    const blocks: Record<string, RawBlock> = {
      '*Model_Space': blockWithLines('*Model_Space', 500),
      '*Paper_Space': blockWithLines('*Paper_Space', 500),
      ORPHAN: blockWithLines('ORPHAN', 80),
    };
    // 시스템 공간 블록은 제외, ORPHAN(80)만 집계.
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(80);
  });

  it('여러 고아 대형 블록의 엔티티를 모두 합산', () => {
    const blocks: Record<string, RawBlock> = {
      PLACED: blockWithLines('PLACED', 100),
      O_A: blockWithLines('O_A', 60),
      O_B: blockWithLines('O_B', 90),
      TINY: blockWithLines('TINY', 3),
    };
    // O_A(60) + O_B(90) = 150. PLACED는 배치됨, TINY는 임계 미만.
    expect(computeOrphanedBlockEntityCount(['PLACED'], blocks)).toBe(150);
  });

  it('블록이 없으면(빈 정의) 0', () => {
    expect(computeOrphanedBlockEntityCount(['ANY'], {})).toBe(0);
  });

  it('익명 블록(A$C...)도 엔티티 임계만으로 고아 판정(이름으로 제외 안 함)', () => {
    const blocks: Record<string, RawBlock> = {
      A$Cf4d565d8: blockWithLines('A$Cf4d565d8', 300),
    };
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(300);
  });

  it('(f) top-level DIMENSION.block이 참조하는 대형 치수블록은 고아 아님', () => {
    // 치수 그림 블록(*D60)은 어떤 INSERT로도 도달 불가하지만 top-level DIMENSION이
    // 그룹코드 2로 참조하고 expand.ts가 실제 전개한다 → 도달성 루트로 seed돼야 한다.
    const blocks: Record<string, RawBlock> = {
      '*D60': blockWithLines('*D60', 60),
    };
    // top-level 참조에 DIMENSION.block('*D60')이 collectReferencedBlockNames로 포함됨.
    expect(computeOrphanedBlockEntityCount(['*D60'], blocks)).toBe(0);
    // 참조가 전혀 없으면(빈 루트) 여전히 고아로 잡힌다 — 반증 대조.
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(60);
  });

  it('(g) 도달 가능한 블록 내부 DIMENSION.block도 BFS로 전파 — 고아 아님', () => {
    // 배치된 PLACED 블록 내부에 DIMENSION이 있고 그 DIMENSION이 치수블록 *D60을 참조.
    // BFS가 collectReferencedBlockNames로 DIMENSION.block을 따라가야 *D60이 도달된다.
    const blocks: Record<string, RawBlock> = {
      PLACED: blockWithLines('PLACED', 100, [dimRef('*D60')]),
      '*D60': blockWithLines('*D60', 60),
    };
    expect(computeOrphanedBlockEntityCount(['PLACED'], blocks)).toBe(0);
  });

  it('블록 키와 name이 달라도 어느 쪽으로든 도달하면 고아 아님', () => {
    // 실제 dxf-parser는 blocks를 name 키로 담지만 방어적으로 키/이름 둘 다 도달 처리.
    const blocks: Record<string, RawBlock> = {
      KEY1: { name: 'REAL_NAME', position: { x: 0, y: 0 }, entities: linesN(100) },
    };
    // top-level이 실제 name으로 참조 → 도달.
    expect(computeOrphanedBlockEntityCount(['REAL_NAME'], blocks)).toBe(0);
    // top-level이 키로 참조해도 도달.
    expect(computeOrphanedBlockEntityCount(['KEY1'], blocks)).toBe(0);
    // 아무도 참조 안 하면 고아.
    expect(computeOrphanedBlockEntityCount([], blocks)).toBe(100);
  });
});

function linesN(n: number): RawEntityBase[] {
  const out: RawEntityBase[] = [];
  for (let i = 0; i < n; i++) out.push({ type: 'LINE' });
  return out;
}

describe('collectReferencedBlockNames', () => {
  it('INSERT.name과 DIMENSION.block을 함께 수집(expand.ts 전개 규칙과 일치)', () => {
    const entities: RawEntityBase[] = [
      insertRef('BLK_A'),
      dimRef('*D1'),
      { type: 'LINE' },
      insertRef('BLK_B'),
      dimRef('*D2'),
    ];
    expect(collectReferencedBlockNames(entities)).toEqual(['BLK_A', '*D1', 'BLK_B', '*D2']);
  });

  it('이름/블록명 없는 참조는 건너뛴다', () => {
    const entities: RawEntityBase[] = [
      { type: 'INSERT' }, // name 없음
      { type: 'DIMENSION' }, // block 없음(비-DWG DXF의 defPoints 근사 치수)
      { type: 'LINE' },
    ];
    expect(collectReferencedBlockNames(entities)).toEqual([]);
  });
});
