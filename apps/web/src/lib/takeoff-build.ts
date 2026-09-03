/**
 * 산출 항목 basis(FormulaNode) 조립 — @s-cube/core 빌더 어댑터 (Phase 4-B, P4-7·P4-9).
 *
 * 단일 진실원천: 수식 조립·계산은 전부 @s-cube/core 의 quantity/ 빌더로 한다
 * (21-CONVENTIONS §4 — 계산 로직은 packages/core 에만). 이 파일은 "수량 소스"(측정값·
 * 구간 체적·수동 입력·다른 항목 참조)를 core 빌더 호출로 얇게 변환하고, 규격의 환산계수·
 * 할증률을 체이닝(convertUnit·applyLoss)할 뿐이다. 새 계산 규칙을 여기서 만들지 않는다.
 *
 * blocked(전 결측) 구간을 소스로 하면 basis 를 만들 수 없다(null) — 곡성류 부분합 누출을
 * 계산 계층에서 막은 것을 항목 계층에서도 그대로 전파한다.
 */
import {
  applyLoss,
  buildSegments,
  convertUnit,
  countTimes,
  derivedContact,
  derivedScaffold,
  derivedShore,
  evaluate,
  fConst,
  fMul,
  fRef,
  fSum,
  polygonArea,
  polylineLength,
  type SectionInput,
  segmentId,
  totalVolume,
} from '@s-cube/core';
import type {
  CalcType,
  FormulaNode,
  MaterialSpec,
  Measurement,
  PVertex,
  StationSection,
} from '@s-cube/schema';
// cell-map 서브패스만 임포트 — @s-cube/xlsx 배럴(exceljs 포함 buildWorkbook)을 정적 그래프에
// 끌어오지 않도록 순수 셀 키 헬퍼만 가져온다(export-xlsx 의 지연 로드 의도 보존).
import {
  itemGeometryKey,
  itemQuantityKey,
  measurementValueKey,
  segmentKey,
} from '@s-cube/xlsx/cell-map';

// ─────────────────────────────────────────────────────────────────────────────
// 수량 소스 — 항목이 어디서 수량을 가져오는가 (P4-7)
// ─────────────────────────────────────────────────────────────────────────────

/** 수량 소스 종류 */
export const TAKEOFF_SOURCE_KINDS = [
  'measurement',
  'segment-volume',
  'manual',
  'ref',
  'derived-contact',
  'derived-scaffold',
  'derived-shore',
  'count',
] as const;

export type TakeoffSourceKind = (typeof TAKEOFF_SOURCE_KINDS)[number];

/** 파생 소스 종류 — 기준 콘크리트 항목에서 자동 전개되는 3종 (RW-5) */
export const DERIVED_SOURCE_KINDS = [
  'derived-contact',
  'derived-scaffold',
  'derived-shore',
] as const;

export type DerivedSourceKind = (typeof DERIVED_SOURCE_KINDS)[number];

/** 측정값 소스 — 도면 측정 한 건(면적/연장)을 그대로 수량으로 */
export interface MeasurementSource {
  kind: 'measurement';
  /** Measurement.id (역추적) */
  measurementId: string;
  /** 측정 취득값 (area: ㎡, length: m) — 조립 시점 캐시 */
  value: number;
  /** 표시 라벨 (측정 label) */
  label: string;
}

/** 구간 체적 소스 — 한 itemKey 의 buildSegments → totalVolume (양단면평균법) */
export interface SegmentVolumeSource {
  kind: 'segment-volume';
  /** 측점 항목 키 ('절토' 등) */
  itemKey: string;
}

/** 수동 입력 소스 — 사용자가 직접 넣은 수량(식·hr·mth·회 등) */
export interface ManualSource {
  kind: 'manual';
  value: number;
  /** 근거 설명 (선택) */
  label?: string;
}

/** 다른 항목 참조 소스 — 참조 항목들의 합/계수 (P4-9, 거푸집=콘크리트 접촉면 등) */
export interface RefSource {
  kind: 'ref';
  /** 참조하는 TakeoffItem.id 목록 (합산) */
  refItemIds: string[];
  /** 참조 항목의 (라벨, 수량) — 조립 시점 캐시 (renderText·evaluate 용) */
  refs: { itemId: string; label: string; quantity: number }[];
  /** 계수 (예: 접촉폭 계수) — 미지정이면 1 */
  factor?: number;
  /** 계수 라벨 */
  factorLabel?: string;
}

/**
 * 파생 소스 — 옹벽 1기 콘크리트 입력에서 거푸집·비계·동바리를 자동 전개 (RW-5, FR-4.9).
 *
 * 핵심 UX: 사용자는 기준 콘크리트 항목(baseItemId)을 선택하고 높이/타설고 1개만 입력한다.
 * 계수 손입력은 없다 — 둘레/면적은 기준 항목의 단면 폴리라인 기하에서 산출된다.
 *   - derived-contact(거푸집)  = 기준 단면 둘레 × 구간 연장  → ㎡
 *   - derived-scaffold(비계)   = 외곽 둘레 × 높이            → ㎡
 *   - derived-shore(동바리)    = 바닥 수평 면적 × 높이(타설고) → 공㎥
 *
 * basePolyline 은 기준 항목의 단면(또는 외곽/바닥) 폴리라인 정점열(도면 단위 raw)이다.
 * buildBasis 가 core 기하(polylineLength/polygonArea)로 둘레/면적을 산출해 살아 있는 fRef 로
 * 조립하고, 미터 환산은 derivedGeometryValues 가 scale 로 1회 수행한다(web 경계 규칙).
 *
 * v1 한계(openIssues): 접촉변 세분(바닥/상단 제외)은 후속 — 전체 둘레를 쓴다.
 */
export interface DerivedSource {
  kind: DerivedSourceKind;
  /** 기준 콘크리트 항목 TakeoffItem.id (역추적) */
  baseItemId: string;
  /** 기준 항목 표시 라벨 (renderText·조립 캐시) */
  baseLabel: string;
  /**
   * 기준 항목의 단면(또는 외곽/바닥) 폴리라인 정점열 — **도면 단위**(raw).
   * core 기하는 도면 단위 순수값만 다루므로(21-CONVENTIONS §4), 미터 환산은
   * derivedGeometryValues 가 scale_mPerUnit 로 1회만 수행한다(measure.ts applyScaleToRaw 대칭).
   *   derived-contact·derived-scaffold: 둘레 산출(polylineLength closed) × scale.
   *   derived-shore: 바닥 수평 면적 산출(polygonArea closed) × scale².
   * 조립 시점 캐시 — 기준 도면 편집 시 refresh 된다(recompute).
   */
  basePolyline: PVertex[];
  /** 폴리라인 폐합 여부 (닫힌 단면이면 true — 대개 콘크리트 단면은 폐합) */
  baseClosed: boolean;
  /** 캘리브레이션 축척 (1 도면단위 = scale m) — 도면단위 기하 → 미터 환산에 사용 */
  scale_mPerUnit: number;
  /** 구간 연장(m) — derived-contact 전용 (거푸집: 둘레 × 연장) */
  length_m?: number;
  /** 높이/타설고(m) — derived-scaffold·derived-shore 전용 (사용자 단일 입력) */
  height_m?: number;
}

/** 블록/심볼 카운트 소스 — 도면 INSERT 자동 계수 (RW-13, P5-17/18) */
export interface CountSource {
  kind: 'count';
  /** 블록명 (DrawingModel.blockInsertCounts 키) */
  blockName: string;
  /** 자동 계수된 삽입 횟수 (조립 시점 캐시) */
  count: number;
  /** 삽입 핸들 목록 — 역추적 근거 */
  handles: string[];
}

export type TakeoffSource =
  | MeasurementSource
  | SegmentVolumeSource
  | ManualSource
  | RefSource
  | DerivedSource
  | CountSource;

/** 파생 소스인지 (좁히기 헬퍼) */
export function isDerivedSource(source: TakeoffSource): source is DerivedSource {
  return (
    source.kind === 'derived-contact' ||
    source.kind === 'derived-scaffold' ||
    source.kind === 'derived-shore'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// basis 조립 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 소스 + 규격으로 basis(FormulaNode) 를 조립한다.
 *
 * @param source   수량 소스
 * @param spec     규격(환산계수·할증률·정척) — 없으면 환산·할증 미적용
 * @param sections 구간 체적 소스일 때 전체 단면 목록 (buildSegments 입력)
 * @returns basis FormulaNode, 또는 null(구간 소스가 blocked = 전 결측이라 산출 차단)
 */
export function buildBasis(
  source: TakeoffSource,
  spec: MaterialSpec | undefined,
  sections: StationSection[],
): FormulaNode | null {
  const base = buildBaseNode(source, spec, sections);
  if (base === null) return null;
  return applySpecAdjustments(base, spec);
}

/** 소스 종류별 기본 수식 노드 (환산·할증 적용 전) */
function buildBaseNode(
  source: TakeoffSource,
  spec: MaterialSpec | undefined,
  sections: StationSection[],
): FormulaNode | null {
  switch (source.kind) {
    case 'measurement':
      return buildMeasurementNode(source, spec);
    case 'segment-volume':
      return buildSegmentVolumeNode(source, sections);
    case 'manual':
      return source.label === undefined ? fConst(source.value) : fConst(source.value, source.label);
    case 'ref':
      return buildRefNode(source);
    case 'derived-contact':
    case 'derived-scaffold':
    case 'derived-shore':
      return buildDerivedNode(source);
    case 'count':
      return countTimes(source.count);
  }
}

/**
 * 파생 소스 → basis (RW-5). 기준 항목의 단면 폴리라인 기하에서 둘레/면적을 산출하고,
 * 살아 있는 fRef(item:<baseItemId>:perimeter|floor-area) × 연장/높이(fConst)로 조립한다.
 *
 * fRef 로 조립하는 이유: 기준 도면 단면이 바뀌면 둘레/면적도 따라가는 살아 있는 수식이
 * 되도록(하드코딩 숫자 금지, P4-12 규약과 동일). evaluate 는 buildRefResolver 가 basePolyline
 * 에서 재산출한 둘레/면적으로 연다.
 *
 * 기하가 조립 불가(정점 < 2)면 null 을 돌려 산출을 차단한다(둘레 0 을 조용히 만들지 않음).
 */
function buildDerivedNode(source: DerivedSource): FormulaNode | null {
  if (source.kind === 'derived-shore') {
    // 동바리: 바닥 수평 면적 × 높이. 면적 산출에 정점 2개(bulge 원) 이상 필요.
    if (source.basePolyline.length < 2) return null;
    const height = source.height_m;
    if (height === undefined || !Number.isFinite(height)) return null;
    const areaRef = fRef(
      itemGeometryKey(source.baseItemId, 'floor-area'),
      `${source.baseLabel} 바닥면적(㎡)`,
    );
    return derivedShore(areaRef, height);
  }
  // 거푸집·비계: 둘레 × (연장 | 높이). 둘레 산출에 정점 2개 이상 필요.
  if (source.basePolyline.length < 2) return null;
  const perimRef = fRef(
    itemGeometryKey(source.baseItemId, 'perimeter'),
    `${source.baseLabel} 둘레(m)`,
  );
  if (source.kind === 'derived-contact') {
    const length = source.length_m;
    if (length === undefined || !Number.isFinite(length)) return null;
    return derivedContact(perimRef, length);
  }
  // derived-scaffold
  const height = source.height_m;
  if (height === undefined || !Number.isFinite(height)) return null;
  return derivedScaffold(perimRef, height);
}

/**
 * 측정 소스 — area-thickness 규격이면 면적×두께(규격 두께), 그 외엔 측정값 그대로.
 * (접촉둘레×연장 파생은 derived-* 소스가 담당한다 — RW-5.)
 *
 * RW-6: area-thickness 는 두께를 **MaterialSpec.thickness_m 에서** 읽는다(source.thickness_m·
 * 하드코딩 0.1 폐지). area-thickness 규격인데 spec.thickness_m 이 없으면 null 을 돌려 산출을
 * 차단한다 — 두께 미상을 조용히 가정하지 않는다.
 *
 * 측정값은 fConst(리터럴)가 아니라 fRef(measurement:<id>:value) 로 조립한다 (P4-12).
 * 그래야 엑셀 수량 셀이 '측정 원장!<셀>' 을 참조하는 살아 있는 수식이 되고, 측정값을
 * 원장에서 고치면 수량이 자동 재계산된다. source.value(취득 캐시)는 조립 시점 evaluate
 * 에서만 쓰이고 엑셀 수식에는 들어가지 않는다.
 */
function buildMeasurementNode(
  source: MeasurementSource,
  spec: MaterialSpec | undefined,
): FormulaNode | null {
  const measured = fRef(measurementValueKey(source.measurementId), source.label);
  const calcType: CalcType | undefined = spec?.calcType;
  if (calcType === 'area-thickness') {
    // 두께는 규격에서만 온다(RW-6). 두께 없는 area-thickness 규격은 산출 차단(null).
    const thickness = spec?.thickness_m;
    if (thickness === undefined) return null;
    // 면적(측정 셀) × 두께(규격 상수)
    return fMul(measured, fConst(thickness, '두께(m)'));
  }
  return measured;
}

/**
 * 구간 체적 소스 — 양단면평균법으로 buildSegments → totalVolume.
 * blocked(전 결측) 이면 null 을 돌려 항목 산출을 차단한다(조용히 부분합 금지).
 *
 * 정상이면 각 구간의 체적을 fRef(segment:<segId>:volume) 로 참조해 합(fSum)한다 (P4-12).
 * segId 는 core·xlsx·web 공유 규약 segmentId(seg.fromId, seg.toId) 다 — 그래야 엑셀 수량
 * 셀이 상세 시트의 =(A1+A2)/2*L 체적 셀을 참조하는 살아 있는 수식이 된다(하드코딩 숫자 금지).
 * 상세 시트에 등록된 CellMap(segment:*:volume)이 실제로 소비된다.
 */
function buildSegmentVolumeNode(
  source: SegmentVolumeSource,
  sections: StationSection[],
): FormulaNode | null {
  const inputs: SectionInput[] = sections.map(toSectionInput);
  const result = buildSegments(inputs, source.itemKey, 'average-end-area', {
    flagOrphans: false,
  });
  // 계산 계층이 blocked 를 판단 — null 이면 항목도 산출 차단.
  if (totalVolume(result) === null) return null;
  if (result.segments.length === 0) {
    // 구간이 없으면 0 (단면 1개 등) — 명시 const 로 근거를 남긴다.
    return fConst(0, `${source.itemKey} 구간 없음`);
  }
  // 구간별 체적 셀 참조를 합산 — 각 항이 상세 시트의 체적 수식 셀을 가리킨다.
  const terms = result.segments.map((seg) => {
    const segId = segmentId(seg.fromId, seg.toId);
    const label = `${seg.from.raw} ~ ${seg.to.raw} 체적`;
    return fRef(segmentKey(segId, 'volume'), label);
  });
  return terms.length === 1 && terms[0] !== undefined ? terms[0] : fSum(terms);
}

/** 유한·비음수만 유효 면적 — 그 외는 결측(undefined)으로 core 에 넘긴다(station-derive 와 동일 규칙) */
function toSectionInput(section: StationSection): SectionInput {
  const valid = Number.isFinite(section.area_m2) && section.area_m2 >= 0;
  return {
    id: section.id,
    station: section.station,
    itemKey: section.itemKey,
    ...(valid ? { area_m2: section.area_m2 } : {}),
    ...(section.measurementId !== undefined ? { measurementId: section.measurementId } : {}),
    ...(section.note !== undefined ? { note: section.note } : {}),
  };
}

/**
 * 참조 소스 — 참조 항목 수량들의 합(fSum) × 계수(있으면).
 * 참조 항목은 fRef 로 렌더(엑셀 셀 참조 대상) — cell 자리에 xlsx 의 itemQuantityKey(id)
 * (item:<id>:quantity) 논리 키를 넣어, @s-cube/xlsx 의 CellMap 등록 키와 정확히 맞춘다
 * (단일 진실원천 — 접미사 불일치로 export 가 죽던 결함 제거, P4-9·P4-12). 조립 시점
 * evaluate 는 캐시된 quantity 로 refResolver 를 구성해 수행한다.
 */
function buildRefNode(source: RefSource): FormulaNode {
  const terms = source.refs.map((r) => fRef(itemQuantityKey(r.itemId), r.label));
  const summed = terms.length === 1 ? terms[0] : fSum(terms);
  // terms.length >= 1 보장은 조립 UI 가 하지만, 방어적으로 빈 참조는 0 으로.
  const sumNode: FormulaNode = summed ?? fConst(0, '참조 없음');
  if (source.factor === undefined || source.factor === 1) return sumNode;
  return convertUnit(sumNode, source.factor, source.factorLabel ?? '계수');
}

/**
 * 파생 소스의 기하 논리 키 → 값 (RW-5) — 기준 항목의 단면 폴리라인에서 둘레/바닥면적 산출.
 *
 * evaluate 는 basis 안의 fRef(item:<id>:perimeter|floor-area) 를 이 값으로 연다. resolver 는
 * 이 map 을 extraValues 로 받아 셀을 해석한다(단일 진실원천 — build 와 evaluate 가 같은 규칙).
 * 기하 산출은 core(polylineLength/polygonArea)만 쓴다(계수·하드코딩 금지).
 */
export function derivedGeometryValues(source: DerivedSource): Map<string, number> {
  const values = new Map<string, number>();
  const scale = source.scale_mPerUnit;
  if (source.kind === 'derived-shore') {
    // 면적: 도면단위² × scale² (measure.ts area 규칙과 동일).
    const area_m2 = polygonArea(source.basePolyline, source.baseClosed) * scale * scale;
    values.set(itemGeometryKey(source.baseItemId, 'floor-area'), area_m2);
  } else {
    // derived-contact·derived-scaffold: 둘레(길이) 도면단위 × scale.
    const perimeter_m = polylineLength(source.basePolyline, source.baseClosed) * scale;
    values.set(itemGeometryKey(source.baseItemId, 'perimeter'), perimeter_m);
  }
  return values;
}

/**
 * 규격 환산계수·할증률 체이닝 (근거 유지).
 * - conversions[0] 이 있으면 × factor (예: ㎥→TON 단위중량, m→본 정척).
 * - lossRate 가 있으면 × (1 + rate) (철근 3% 등).
 * 적용 순서: 환산 → 할증 (발주 단위로 환산 후 할증). round 는 하지 않는다(표시 시점만).
 */
function applySpecAdjustments(node: FormulaNode, spec: MaterialSpec | undefined): FormulaNode {
  if (spec === undefined) return node;
  let out = node;
  const conv = spec.conversions?.[0];
  if (conv !== undefined) {
    out = convertUnit(
      out,
      conv.factor,
      `${conv.toUnit} 환산계수${conv.note ? ` (${conv.note})` : ''}`,
    );
  }
  if (spec.lossRate !== undefined && spec.lossRate > 0) {
    out = applyLoss(out, spec.lossRate);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수량 평가 (순수) — basis 는 이제 측정·구간·항목 셀 참조(ref)를 담으므로,
// 논리 키(measurement:*·segment:*·item:*)를 수치로 여는 resolver 가 필요하다.
// resolver 는 엑셀 렌더의 CellMap 논리 키와 동일 규약을 쓴다(단일 진실원천).
// ─────────────────────────────────────────────────────────────────────────────

/** 논리 키 → 수치 해석기 (evaluate 용). 미등록 키는 에러로 승격 */
export type RefValueResolver = (cell: string) => number;

/**
 * basis 를 수량으로 평가한다 — ref 노드(측정·구간·항목 셀)는 resolver 로 해석한다.
 * 내부 계산은 반올림하지 않는다(round 노드만 예외). basis 가 null(차단)이면 호출 측이
 * 이 함수를 부르지 않는다.
 */
export function evaluateQuantity(basis: FormulaNode, resolver: RefValueResolver): number {
  return evaluate(basis, resolver);
}

/**
 * 논리 키 → 수치 resolver 를 만든다 (evaluate 용, 순수).
 *
 * 커버 규약:
 *   measurement:<id>:value   측정 취득값 (measurements 최신값)
 *   segment:<segId>:volume   구간 체적 ((a1+a2)/2×L, buildSegments 결과)
 *   segment:<segId>:a1|a2|length  구간 성분 (필요 시)
 *   item:<id>:quantity       다른 산출 항목 수량
 * extraValues 는 위에서 채워지지 않는 논리 키의 폴백(예: 측정이 원장에 없을 때 소스 캐시값).
 * 미등록 키는 에러로 승격(조용히 0 처리 금지).
 */
export function buildRefResolver(context: {
  sections: StationSection[];
  measurements: readonly Measurement[];
  itemQuantities: ReadonlyMap<string, number>;
  extraValues?: ReadonlyMap<string, number>;
}): RefValueResolver {
  const values = new Map<string, number>();

  // 폴백값 먼저(측정 원장에 없는 측정의 소스 캐시값 등) — 이후 최신값이 덮어쓴다.
  if (context.extraValues !== undefined) {
    for (const [key, value] of context.extraValues) {
      values.set(key, value);
    }
  }

  // 측정값 — 최신 measurements 로 채운다(원장 갱신 반영, 폴백을 덮어씀).
  for (const m of context.measurements) {
    values.set(measurementValueKey(m.id), m.value);
  }

  // 구간 성분·체적 — itemKey 별 buildSegments 결과에서.
  const inputs: SectionInput[] = context.sections.map(toSectionInput);
  const itemKeys = new Set(context.sections.map((s) => s.itemKey));
  for (const itemKey of itemKeys) {
    const result = buildSegments(inputs, itemKey, 'average-end-area', { flagOrphans: false });
    for (const seg of result.segments) {
      const segId = segmentId(seg.fromId, seg.toId);
      values.set(segmentKey(segId, 'a1'), seg.a1);
      values.set(segmentKey(segId, 'a2'), seg.a2);
      values.set(segmentKey(segId, 'length'), seg.length_m);
      values.set(segmentKey(segId, 'volume'), seg.volume_m3);
    }
  }

  return (cell: string): number => {
    const direct = values.get(cell);
    if (direct !== undefined) return direct;
    // 항목 참조 (item:<id>:quantity) — itemQuantities 로 해석.
    const itemMatch = /^item:(.+):quantity$/.exec(cell);
    if (itemMatch?.[1] !== undefined) {
      const q = context.itemQuantities.get(itemMatch[1]);
      if (q !== undefined) return q;
    }
    throw new Error(`참조 셀 값을 찾을 수 없습니다: ${cell}`);
  };
}

/**
 * 측정·구간·수동 소스 basis 평가 (항목 참조 없음) — sections·measurements 로 resolver 구성.
 * 측정·구간 basis 는 이제 ref 노드를 담으므로 resolver 없이 평가할 수 없다.
 */
export function evaluatePlain(
  basis: FormulaNode,
  context: { sections: StationSection[]; measurements: readonly Measurement[] },
): number {
  const resolver = buildRefResolver({
    sections: context.sections,
    measurements: context.measurements,
    itemQuantities: new Map(),
  });
  return evaluate(basis, resolver);
}
