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
import type { RawDxf } from './raw-types.ts';
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
  const paperSpaceExcludedCount = allRawEntities.length - modelEntities.length;
  const blocks = raw.blocks ?? {};
  const normalized = expandAndNormalize(modelEntities, blocks, unsupportedCounts);
  // A. 좌표 위생처리 — 쓰레기 좌표(비유한·비현실적 초과)를 제거해 bounds 오염을 막는다.
  // 레이어 사용 수·bounds는 위생처리 후의 정상 엔티티만 반영해야 한다.
  const { entities, sanitizedCount } = sanitizeEntities(normalized);
  return {
    dxfVersion: readHeaderString(raw, '$ACADVER') ?? '',
    insUnits: readHeaderNumber(raw, '$INSUNITS') ?? 0,
    layers: buildLayers(raw, entities),
    entities,
    unsupportedCounts,
    sanitizedCount,
    paperSpaceExcludedCount,
    bounds: mergeBounds(entities.map(entityBounds)),
  };
}
