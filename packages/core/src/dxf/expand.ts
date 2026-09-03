/**
 * P1-3: INSERT 재귀 전개 — 위치·스케일·회전 Mat3 누적.
 *
 * - depth 제한(MAX_INSERT_DEPTH)으로 순환 참조를 방지한다
 * - 전개된 엔티티는 EntityOrigin{blockPath, transform}을 보존한다
 * - MINSERT(행·열 배열)는 회전된 프레임에서 간격 오프셋을 적용해 복제한다
 * - 비균등 스케일의 ARC/CIRCLE/bulge는 transform.ts에서 폴리라인 근사로 폴백
 * - DIMENSION은 NDimension으로 정규화(측정·dim-check용)하는 동시에, 참조 치수블록
 *   (그룹코드 2)을 INSERT처럼 재귀 전개해 실제 치수 그림(선·화살표·텍스트)을 렌더한다.
 * - 블록 내 layer '0' / colorIndex 0(BYBLOCK)·미지정 엔티티는 부모(INSERT/DIMENSION)의
 *   레이어·색을 상속한다(AutoCad 관례) — 치수 텍스트·선의 가시성 직결.
 */
import type { Mat3, NEntity, NHatch } from '@s-cube/schema';
import {
  composeMat3,
  IDENTITY_MAT3,
  isIdentityMat3,
  mat3FromInsert,
  mat3Translation,
} from '../geometry/mat3.ts';
import { normalizeEntity } from './normalize.ts';
import type { RawBlock, RawDimensionEntity, RawEntityBase, RawInsertEntity } from './raw-types.ts';
import { transformEntity } from './transform.ts';

const DEG_TO_RAD = Math.PI / 180;

/** INSERT 재귀 전개 최대 깊이 — 순환 참조 방지 */
export const MAX_INSERT_DEPTH = 16;

/** unsupportedCounts에 쓰는 특수 키 */
export const UNSUPPORTED_KEY_MISSING_BLOCK = 'INSERT(블록 미해결)';
export const UNSUPPORTED_KEY_DEPTH_EXCEEDED = 'INSERT(깊이 초과)';

/** ACI 특수값 — 0 = BYBLOCK(부모 색 상속), 256 = BYLAYER(레이어 색 유지) */
const ACI_BYBLOCK = 0;

function countUp(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

interface ExpandContext {
  blocks: Readonly<Record<string, RawBlock>>;
  unsupportedCounts: Record<string, number>;
  out: NEntity[];
  /**
   * RW-2: 블록명 → 그 블록 정의 안의 HATCH[](블록-로컬 좌표). dxf-parser가 HATCH를
   * 버리므로 원문에서 별도 파싱해 넘긴다. 블록 전개 시 INSERT 변환을 적용해 emit한다.
   */
  hatchesByBlock: ReadonlyMap<string, NHatch[]>;
}

/**
 * 블록 전개 시 부모(INSERT/DIMENSION)의 레이어·색 상속.
 * - undefined = 최상위(모델 공간) 엔티티 → 상속 없음
 */
interface Inherit {
  layer: string;
  colorIndex?: number;
}

/**
 * 블록 내 엔티티에 부모 컨텍스트의 레이어·색을 상속한다(제자리 변형 아님, 원본 유지).
 * - layer === '0' → 부모 레이어로 치환
 * - colorIndex === 0(BYBLOCK) 또는 미지정 → 부모 색으로 치환 (256=BYLAYER은 유지)
 */
function applyInheritance(e: NEntity, inherit: Inherit | undefined): void {
  if (inherit === undefined) return;
  if (e.layer === '0') e.layer = inherit.layer;
  if (
    (e.colorIndex === undefined || e.colorIndex === ACI_BYBLOCK) &&
    inherit.colorIndex !== undefined
  ) {
    e.colorIndex = inherit.colorIndex;
  }
}

/** INSERT/DIMENSION 자신의 (부모에서 이미 상속된) 레이어·색으로 자식 상속 컨텍스트를 만든다 */
function inheritFrom(raw: RawEntityBase, parent: Inherit | undefined): Inherit {
  let layer = raw.layer ?? '0';
  // 부모가 있고 이 INSERT/DIMENSION 자체가 layer '0'이면 부모 레이어를 물려받아 다시 전달
  if (layer === '0' && parent !== undefined) layer = parent.layer;
  const next: Inherit = { layer };
  const color = raw.colorIndex;
  if (color !== undefined && color !== ACI_BYBLOCK) {
    next.colorIndex = color; // 명시된 색(BYLAYER 포함) → 하위 BYBLOCK가 물려받음
  } else if (parent !== undefined && parent.colorIndex !== undefined) {
    next.colorIndex = parent.colorIndex; // BYBLOCK/미지정 → 부모 색을 물려받아 전달
  }
  return next;
}

function expandInsert(
  ctx: ExpandContext,
  raw: RawInsertEntity,
  parentTransform: Mat3,
  blockPath: readonly string[],
  depth: number,
  parentInherit: Inherit | undefined,
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
  const childInherit = inheritFrom(raw, parentInherit);
  const blockHatches = ctx.hatchesByBlock.get(name);
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < columnCount; col++) {
      // 블록 내용 좌표는 기준점(base point) 기준 → T(-base) 선적용.
      // MINSERT 간격은 스케일·회전된 로컬 프레임에서 적용한다.
      const local = mat3Translation(col * columnSpacing - baseX, row * rowSpacing - baseY);
      const instanceMat = composeMat3(parentTransform, composeMat3(insertMat, local));
      walkEntities(ctx, block.entities ?? [], instanceMat, nextPath, depth + 1, childInherit);
      // RW-2: 이 블록 정의의 HATCH도 같은 인스턴스 변환으로 전개(dxf-parser가 버린 것).
      if (blockHatches !== undefined) {
        emitBlockHatches(ctx, blockHatches, instanceMat, nextPath, childInherit);
      }
    }
  }
}

/** 블록 정의의 HATCH[](로컬 좌표)를 인스턴스 변환·상속 적용해 out에 push한다. */
function emitBlockHatches(
  ctx: ExpandContext,
  hatches: readonly NHatch[],
  transform: Mat3,
  blockPath: readonly string[],
  inherit: Inherit | undefined,
): void {
  for (const hatch of hatches) {
    // 원본 공유 방지 — 인스턴스마다 새 객체로 push한다.
    pushNormalized(ctx, { ...hatch, loops: hatch.loops }, transform, blockPath, inherit);
  }
}

/**
 * DIMENSION 전개 — NDimension을 push(측정·dim-check용)하고, 참조 치수블록(그룹코드 2)이
 * 존재하면 그 블록을 INSERT처럼 재귀 전개해 실제 선·화살표·텍스트를 추가한다.
 * 치수블록 엔티티는 WCS 좌표(블록 base 0,0,0)이므로 현재 transform을 그대로 적용한다.
 * 반환: 블록을 전개했으면 true(→ NDimension.hasPicture).
 */
function expandDimensionBlock(
  ctx: ExpandContext,
  raw: RawDimensionEntity,
  transform: Mat3,
  blockPath: readonly string[],
  depth: number,
  parentInherit: Inherit | undefined,
): boolean {
  const name = raw.block;
  const block = name !== undefined ? ctx.blocks[name] : undefined;
  // 블록 없음·비어있음(비-DWG DXF 등) → 전개하지 않고 defPoints 근사 유지
  if (name === undefined || block === undefined || (block.entities ?? []).length === 0) {
    return false;
  }
  if (depth >= MAX_INSERT_DEPTH) {
    countUp(ctx.unsupportedCounts, UNSUPPORTED_KEY_DEPTH_EXCEEDED);
    return false;
  }
  const baseX = block.position?.x ?? 0;
  const baseY = block.position?.y ?? 0;
  // 치수블록은 항등 근사(base 보통 0,0,0). base가 있으면 T(-base)만 반영.
  const instanceMat =
    baseX === 0 && baseY === 0
      ? transform
      : composeMat3(transform, mat3Translation(-baseX, -baseY));
  const childInherit = inheritFrom(raw, parentInherit);
  walkEntities(
    ctx,
    block.entities ?? [],
    instanceMat,
    [...blockPath, name],
    depth + 1,
    childInherit,
  );
  return true;
}

function pushNormalized(
  ctx: ExpandContext,
  normalized: NEntity,
  transform: Mat3,
  blockPath: readonly string[],
  inherit: Inherit | undefined,
): void {
  applyInheritance(normalized, inherit);
  if (blockPath.length === 0 && isIdentityMat3(transform)) {
    ctx.out.push(normalized);
    return;
  }
  const transformed = transformEntity(normalized, transform);
  // transformEntity가 새 객체를 만들 수 있으므로 상속을 다시 반영해 둔다(kind 변경 대비).
  applyInheritance(transformed, inherit);
  transformed.origin = { blockPath: [...blockPath], transform };
  ctx.out.push(transformed);
}

function walkEntities(
  ctx: ExpandContext,
  rawEntities: readonly RawEntityBase[],
  transform: Mat3,
  blockPath: readonly string[],
  depth: number,
  inherit: Inherit | undefined,
): void {
  for (const raw of rawEntities) {
    if (raw.type === 'INSERT') {
      expandInsert(ctx, raw as RawInsertEntity, transform, blockPath, depth, inherit);
      continue;
    }
    if (raw.type === 'DIMENSION') {
      const dimRaw = raw as RawDimensionEntity;
      const hasPicture = expandDimensionBlock(ctx, dimRaw, transform, blockPath, depth, inherit);
      const normalized = normalizeEntity(raw);
      if (normalized === null) {
        countUp(ctx.unsupportedCounts, raw.type ?? 'UNKNOWN');
        continue;
      }
      // 블록을 전개한 경우만 hasPicture 표시(렌더러가 근사 틱 생략)
      if (hasPicture && normalized.kind === 'dimension') normalized.hasPicture = true;
      pushNormalized(ctx, normalized, transform, blockPath, inherit);
      continue;
    }
    const normalized = normalizeEntity(raw);
    if (normalized === null) {
      // 미지원 타입 또는 필수 좌표 결손 — 조용히 버리지 않고 집계 (P1-2)
      countUp(ctx.unsupportedCounts, raw.type ?? 'UNKNOWN');
      continue;
    }
    pushNormalized(ctx, normalized, transform, blockPath, inherit);
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
  hatchesByBlock: ReadonlyMap<string, NHatch[]> = new Map(),
): NEntity[] {
  const ctx: ExpandContext = { blocks, unsupportedCounts, out: [], hatchesByBlock };
  walkEntities(ctx, rawEntities, IDENTITY_MAT3, [], 0, undefined);
  return ctx.out;
}
