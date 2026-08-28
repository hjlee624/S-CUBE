/**
 * P1-3: INSERT 재귀 전개 — 위치·스케일·회전 Mat3 누적.
 *
 * - depth 제한(MAX_INSERT_DEPTH)으로 순환 참조를 방지한다
 * - 전개된 엔티티는 EntityOrigin{blockPath, transform}을 보존한다
 * - MINSERT(행·열 배열)는 회전된 프레임에서 간격 오프셋을 적용해 복제한다
 * - 비균등 스케일의 ARC/CIRCLE/bulge는 transform.ts에서 폴리라인 근사로 폴백
 */
import type { Mat3, NEntity } from '@s-cube/schema';
import {
  composeMat3,
  IDENTITY_MAT3,
  isIdentityMat3,
  mat3FromInsert,
  mat3Translation,
} from '../geometry/mat3.ts';
import { normalizeEntity } from './normalize.ts';
import type { RawBlock, RawEntityBase, RawInsertEntity } from './raw-types.ts';
import { transformEntity } from './transform.ts';

const DEG_TO_RAD = Math.PI / 180;

/** INSERT 재귀 전개 최대 깊이 — 순환 참조 방지 */
export const MAX_INSERT_DEPTH = 16;

/** unsupportedCounts에 쓰는 특수 키 */
export const UNSUPPORTED_KEY_MISSING_BLOCK = 'INSERT(블록 미해결)';
export const UNSUPPORTED_KEY_DEPTH_EXCEEDED = 'INSERT(깊이 초과)';

function countUp(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

interface ExpandContext {
  blocks: Readonly<Record<string, RawBlock>>;
  unsupportedCounts: Record<string, number>;
  out: NEntity[];
}

function expandInsert(
  ctx: ExpandContext,
  raw: RawInsertEntity,
  parentTransform: Mat3,
  blockPath: readonly string[],
  depth: number,
): void {
  const name = raw.name;
  const block = name !== undefined ? ctx.blocks[name] : undefined;
  if (name === undefined || block === undefined) {
    countUp(ctx.unsupportedCounts, UNSUPPORTED_KEY_MISSING_BLOCK);
    return;
  }
  if (depth >= MAX_INSERT_DEPTH) {
    countUp(ctx.unsupportedCounts, UNSUPPORTED_KEY_DEPTH_EXCEEDED);
    return;
  }
  const pos = { x: raw.position?.x ?? 0, y: raw.position?.y ?? 0 };
  const scaleX = raw.xScale ?? 1;
  const scaleY = raw.yScale ?? 1;
  const rotationRad = (raw.rotation ?? 0) * DEG_TO_RAD;
  const baseX = block.position?.x ?? 0;
  const baseY = block.position?.y ?? 0;
  const insertMat = mat3FromInsert(pos, scaleX, scaleY, rotationRad);
  const columnCount = Math.max(1, raw.columnCount ?? 1);
  const rowCount = Math.max(1, raw.rowCount ?? 1);
  const columnSpacing = raw.columnSpacing ?? 0;
  const rowSpacing = raw.rowSpacing ?? 0;
  const nextPath = [...blockPath, name];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < columnCount; col++) {
      // 블록 내용 좌표는 기준점(base point) 기준 → T(-base) 선적용.
      // MINSERT 간격은 스케일·회전된 로컬 프레임에서 적용한다.
      const local = mat3Translation(col * columnSpacing - baseX, row * rowSpacing - baseY);
      const instanceMat = composeMat3(parentTransform, composeMat3(insertMat, local));
      walkEntities(ctx, block.entities ?? [], instanceMat, nextPath, depth + 1);
    }
  }
}

function walkEntities(
  ctx: ExpandContext,
  rawEntities: readonly RawEntityBase[],
  transform: Mat3,
  blockPath: readonly string[],
  depth: number,
): void {
  for (const raw of rawEntities) {
    if (raw.type === 'INSERT') {
      expandInsert(ctx, raw as RawInsertEntity, transform, blockPath, depth);
      continue;
    }
    const normalized = normalizeEntity(raw);
    if (normalized === null) {
      // 미지원 타입 또는 필수 좌표 결손 — 조용히 버리지 않고 집계 (P1-2)
      countUp(ctx.unsupportedCounts, raw.type ?? 'UNKNOWN');
      continue;
    }
    if (blockPath.length === 0 && isIdentityMat3(transform)) {
      ctx.out.push(normalized);
      continue;
    }
    const transformed = transformEntity(normalized, transform);
    transformed.origin = { blockPath: [...blockPath], transform };
    ctx.out.push(transformed);
  }
}

/**
 * 최상위 엔티티 목록을 정규화하고 INSERT를 재귀 전개해 world 좌표 NEntity[]로 평탄화.
 * 미지원·미해결 항목은 unsupportedCounts에 타입명별로 집계된다.
 */
export function expandAndNormalize(
  rawEntities: readonly RawEntityBase[],
  blocks: Readonly<Record<string, RawBlock>>,
  unsupportedCounts: Record<string, number>,
): NEntity[] {
  const ctx: ExpandContext = { blocks, unsupportedCounts, out: [] };
  walkEntities(ctx, rawEntities, IDENTITY_MAT3, [], 0);
  return ctx.out;
}
