/**
 * P1-1 ~ P1-5: DXF 텍스트 → DrawingModel 전체 파이프라인.
 *
 * 1. dxf-parser 파싱 (parse.ts)
 * 2. 파서가 버리는 타입 사전 집계 (scan-unsupported.ts — HATCH 등)
 * 3. 정규화 + INSERT 재귀 전개 (normalize.ts / expand.ts)
 * 4. $ACADVER·$INSUNITS 헤더, 레이어 테이블, 전체 bounds 집계
 */
import type { DrawingModel, Layer, NEntity } from '@s-cube/schema';
import { entityBounds, mergeBounds } from '../geometry/bounds.ts';
import { expandAndNormalize } from './expand.ts';
import { parseDxfRaw } from './parse.ts';
import { parseHatchEntities } from './parse-hatch.ts';
import type { RawDxf, RawEntityBase, RawInsertEntity } from './raw-types.ts';
import { sanitizeEntities } from './sanitize.ts';
import { scanParserDroppedTypes } from './scan-unsupported.ts';

function readHeaderString(raw: RawDxf, key: string): string | null {
  const v = raw.header?.[key];
  return typeof v === 'string' ? v : null;
}

function readHeaderNumber(raw: RawDxf, key: string): number | null {
  const v = raw.header?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** P1-5: 레이어 테이블 + 엔티티별 레이어 사용 수 집계 */
function buildLayers(raw: RawDxf, entities: readonly NEntity[]): Layer[] {
  const countByLayer = new Map<string, number>();
  for (const e of entities) {
    countByLayer.set(e.layer, (countByLayer.get(e.layer) ?? 0) + 1);
  }
  const layers: Layer[] = [];
  const seen = new Set<string>();
  const table = raw.tables?.layer?.layers ?? {};
  for (const [key, rawLayer] of Object.entries(table)) {
    const name = rawLayer.name ?? key;
    if (seen.has(name)) continue;
    seen.add(name);
    layers.push({
      name,
      // 음수(레이어 꺼짐)는 절대값으로 정규화 (dxf-parser가 이미 abs 처리하지만 방어)
      colorIndex: Math.abs(rawLayer.colorIndex ?? 7),
      visible: (rawLayer.visible ?? true) && !(rawLayer.frozen ?? false),
      entityCount: countByLayer.get(name) ?? 0,
    });
  }
  // 테이블에 없지만 엔티티가 참조하는 레이어도 노출
  for (const [name, entityCount] of countByLayer) {
    if (seen.has(name)) continue;
    seen.add(name);
    layers.push({ name, colorIndex: 7, visible: true, entityCount });
  }
  return layers;
}

/**
 * RW-13: 최상위 모델 공간 INSERT 를 블록명별로 집계한다.
 * 익명 블록(*D·*U 등)·빈 이름은 제외한다. 핸들은 역추적 근거.
 */
function collectBlockInsertCounts(
  rawEntities: readonly RawEntityBase[],
): Record<string, { count: number; handles: string[] }> {
  const counts: Record<string, { count: number; handles: string[] }> = {};
  for (const e of rawEntities) {
    if (e.type !== 'INSERT') continue;
    const ins = e as RawInsertEntity;
    const name = typeof ins.name === 'string' ? ins.name.trim() : '';
    if (name === '' || name.startsWith('*')) continue;
    const handle = ins.handle !== undefined ? String(ins.handle) : '';
    const entry = counts[name];
    if (entry === undefined) {
      counts[name] = { count: 1, handles: handle !== '' ? [handle] : [] };
    } else {
      entry.count += 1;
      if (handle !== '') entry.handles.push(handle);
    }
  }
  return counts;
}

/**
 * DXF 텍스트 전체 파이프라인 — 파싱·정규화·블록 전개·헤더/레이어/경계 집계.
 * 실패 시 한국어 메시지의 Error를 던진다.
 */
export function parseAndNormalizeDxf(text: string): DrawingModel {
  const raw = parseDxfRaw(text);
  const unsupportedCounts: Record<string, number> = {};
  scanParserDroppedTypes(text, unsupportedCounts);
  // 레이아웃(페이퍼 스페이스) 제외 — 도곽·표제부가 모델 뷰에 껴드는 것을 막는다.
  // 블록 전개 전에 최상위에서 걸러야 페이퍼 스페이스 INSERT의 하위까지 함께 제외된다.
  const allRawEntities = raw.entities ?? [];
  const modelEntities = allRawEntities.filter((e) => e.inPaperSpace !== true);
  const rawPaperSpaceExcluded = allRawEntities.length - modelEntities.length;
  const blocks = raw.blocks ?? {};

  // RW-13: INSERT 카운트는 expandAndNormalize 전에 수집한다(전개 후엔 INSERT가 사라짐).
  const blockInsertCounts = collectBlockInsertCounts(modelEntities);

  // RW-2: HATCH는 dxf-parser가 버리므로 원문 DXF에서 경계 loop를 직접 파싱한다.
  // 실도면에서 HATCH는 대부분 블록 정의(BLOCKS) 안에 있고 ENTITIES의 INSERT로 배치되므로,
  // 블록별 HATCH는 expandAndNormalize에 넘겨 INSERT 변환으로 전개하고(hatchesByBlock),
  // 모델 공간(ENTITIES)에 직접 있는 HATCH만 여기서 최상위 병합한다.
  const hatchResult = parseHatchEntities(text);
  const normalized = expandAndNormalize(
    modelEntities,
    blocks,
    unsupportedCounts,
    hatchResult.hatchesByBlock,
  );

  // 성공 파싱한 HATCH는 이제 지원되므로 최종 unsupportedCounts.HATCH에는 "구조 파싱에 실패해
  // 못 읽은 HATCH"(failedCount)만 남긴다(P1-2). 사전 스캔값(scannedHatch)은 페이퍼 스페이스·
  // 성공 파싱까지 포함한 원문 총계이므로 신뢰하지 않고, failedCount로 무조건 덮어쓴다.
  // 이렇게 하면 사전 스캔이 HATCH 변종을 놓쳐 0이어도(scannedHatch=0) 실제 파싱 실패가
  // 조용히 사라지지 않는다. 실패 0이면 키를 삭제한다.
  if (hatchResult.failedCount > 0) unsupportedCounts.HATCH = hatchResult.failedCount;
  else delete unsupportedCounts.HATCH;
  // 페이퍼 스페이스 HATCH는 dxf-parser가 애초에 버려 raw.entities에 없으므로 여기서 합산한다.
  const paperSpaceExcludedCount = rawPaperSpaceExcluded + hatchResult.paperSpaceExcludedCount;

  // A. 좌표 위생처리 — 쓰레기 좌표(비유한·비현실적 초과)를 제거해 bounds 오염을 막는다.
  // 레이어 사용 수·bounds는 위생처리 후의 정상 엔티티만 반영해야 한다.
  // HATCH도 위생처리·상대 이상치 대상에 포함해 손상 loop가 bounds를 오염시키지 않게 한다.
  // 모델 공간 HATCH는 여기서 병합(블록 HATCH는 이미 normalized에 전개됨).
  const { entities, sanitizedCount } = sanitizeEntities([
    ...normalized,
    ...hatchResult.modelHatches,
  ]);
  return {
    dxfVersion: readHeaderString(raw, '$ACADVER') ?? '',
    insUnits: readHeaderNumber(raw, '$INSUNITS') ?? 0,
    layers: buildLayers(raw, entities),
    entities,
    unsupportedCounts,
    sanitizedCount,
    paperSpaceExcludedCount,
    bounds: mergeBounds(entities.map(entityBounds)),
    blockInsertCounts,
  };
}
