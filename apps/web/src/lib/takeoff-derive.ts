/**
 * 산출 항목 파생 — EditableTakeoffItem 조립·재계산 (Phase 4-B, P4-10).
 *
 * EditableTakeoffItem = schema TakeoffItem(basis·quantity·sourceRefs) + 편집 메타(source·
 * blocked). basis 조립·수량 평가는 lib/takeoff-build.ts(→ @s-cube/core) 순수 함수로 한다.
 *
 * 재계산 의존 그래프(P4-10): 참조(ref) 항목은 참조 대상의 수량이 확정된 뒤에 평가해야 한다.
 * recomputeItems 는 (1) 비참조 항목을 먼저 평가하고 (2) 참조 항목을 그 결과로 평가한다.
 * 순환 참조는 미해결(NaN)로 남겨 조용히 잘못된 값을 만들지 않는다.
 */
import type {
  CalcType,
  FormulaNode,
  MaterialSpec,
  Measurement,
  StationSection,
  TakeoffItem,
} from '@s-cube/schema';
import { measurementValueKey } from '@s-cube/xlsx/cell-map';
import {
  buildBasis,
  buildRefResolver,
  derivedGeometryValues,
  evaluateQuantity,
  isDerivedSource,
  type TakeoffSource,
} from './takeoff-build.ts';

/**
 * 편집 가능한 산출 항목 — 스토어 보관 형태.
 * schema TakeoffItem 필드에 편집 메타를 얹는다. 저장(.scube)·엑셀 export 시에는
 * toTakeoffItem 으로 schema TakeoffItem 로 좁혀 내보낸다.
 */
export interface EditableTakeoffItem {
  id: string;
  /** 공종 (대공종·중공종·세부공종은 workType 문자열 계층으로 표현: '토공사 > 흙깎기') */
  workType: string;
  /** 표시 명칭 (규격 name 기본, 사용자 수정 가능) */
  name: string;
  /** MaterialSpec.code — 미선택이면 '' */
  specCode: string;
  unit: string;
  /**
   * 계산 유형 (RW-7) — 규격에서 파생(spec.calcType) 또는 파생 소스에서 결정한 캐시.
   * 산출서 표시·정합 대조·검증에 쓴다. 미확정이면 undefined.
   */
  calcType?: CalcType;
  /** 수량 소스 (측정·구간·수동·참조·파생) */
  source: TakeoffSource;
  /** 산출근거 트리 — 조립 결과. blocked 면 null */
  basis: FormulaNode | null;
  /** 계산 결과(캐시) — 내부 계산 반올림 없음. 차단·미해결이면 NaN */
  quantity: number;
  /** 산출 차단 (전 결측 구간 소스 등) — UI 가 '산출 불가' 표시 */
  blocked: boolean;
  /** 역추적 출처 (도면·handle) */
  sourceRefs: { drawingId: string; handles: string[] }[];
}

/** 신규 항목 초안 — basis·quantity·blocked 는 조립이 채운다 */
export type TakeoffDraft = Omit<EditableTakeoffItem, 'basis' | 'quantity' | 'blocked'>;

/**
 * 초안 + 규격 + 현재 단면 + 측정 원장 + 기존 항목으로 basis·quantity·blocked 를 확정한다.
 *
 * 원본 갱신 대칭성(P4-10):
 * - 측정 소스는 measurementId 로 measurements 최신값을 재조회해 source.value(및 thickness)를
 *   refresh 한다 — 측정값이 12.5→13.1 로 바뀌면 항목 수량도 따라간다.
 * - 참조(ref) 소스는 refs 캐시(itemId→quantity)를 allItems 최신 수량으로 덮어써 오래된
 *   캐시가 새지 않게 한다.
 * 그런 뒤 basis 를 조립하고, 측정·구간·항목 셀 참조를 resolver 로 여는 순수 평가를 한다.
 */
export function reassembleItem(
  draft: TakeoffDraft | EditableTakeoffItem,
  spec: MaterialSpec | undefined,
  sections: StationSection[],
  allItems: EditableTakeoffItem[],
  measurements: readonly Measurement[] = [],
): EditableTakeoffItem {
  // 측정 소스면 최신 측정값으로, 참조 소스면 최신 항목 수량으로 캐시 갱신.
  const source = refreshSourceCache(draft.source, allItems, measurements);
  const calcType = resolveCalcType(source, spec);
  const basis = buildBasis(source, spec, sections);

  if (basis === null) {
    // 소스가 blocked (전 결측 구간·두께 미상 area-thickness 등) — 산출 차단.
    return {
      ...draft,
      source,
      ...(calcType !== undefined ? { calcType } : {}),
      basis: null,
      quantity: Number.NaN,
      blocked: true,
    };
  }

  const quantity = evaluateItemQuantity(basis, source, sections, measurements, allItems);
  return {
    ...draft,
    source,
    ...(calcType !== undefined ? { calcType } : {}),
    basis,
    quantity,
    blocked: false,
  };
}

/**
 * 항목 계산 유형 확정 (RW-7) — 규격 우선(spec.calcType), 없으면 파생 소스에서 결정.
 * 거푸집·비계·동바리 파생은 접촉둘레×연장 계열이므로 taxonomy 상 'contact-length'.
 */
function resolveCalcType(
  source: TakeoffSource,
  spec: MaterialSpec | undefined,
): CalcType | undefined {
  if (spec?.calcType !== undefined) return spec.calcType;
  switch (source.kind) {
    case 'derived-contact':
    case 'derived-scaffold':
    case 'derived-shore':
      return 'contact-length';
    case 'ref':
      return 'ref';
    case 'manual':
      return 'manual';
    default:
      return undefined;
  }
}

/**
 * 소스 캐시 갱신 (순수) — 원본(측정·항목) 변경을 소스에 흡수한다.
 * - measurement: measurementId 로 최신 Measurement.value 를 재조회해 value 갱신
 *   (label 도 최신 명명으로; 측정이 삭제됐으면 이전 캐시값 유지).
 * - ref: refItemIds 로 최신 항목명·수량을 refs 캐시에 반영.
 */
function refreshSourceCache(
  source: TakeoffSource,
  allItems: EditableTakeoffItem[],
  measurements: readonly Measurement[],
): TakeoffSource {
  if (source.kind === 'measurement') {
    const latest = measurements.find((m) => m.id === source.measurementId);
    if (latest === undefined) return source; // 측정 삭제 등 — 이전 취득 캐시 유지
    return { ...source, value: latest.value, label: latest.label };
  }
  if (source.kind === 'ref') {
    const byId = new Map(allItems.map((it) => [it.id, it]));
    return {
      ...source,
      refs: source.refItemIds.map((itemId) => {
        const target = byId.get(itemId);
        return {
          itemId,
          label: target?.name ?? itemId,
          quantity: target?.quantity ?? Number.NaN,
        };
      }),
    };
  }
  if (isDerivedSource(source)) {
    // 파생 소스: 기준 항목명(baseLabel) 을 최신 항목명으로 갱신(역추적 라벨 최신화).
    // basePolyline 은 기준 항목의 단면 기하 캐시 — 기준 도면 편집 재연결은 UI 가 재지정한다.
    const base = allItems.find((it) => it.id === source.baseItemId);
    if (base === undefined) return source; // 기준 항목 삭제 등 — 이전 캐시 유지
    return { ...source, baseLabel: base.name };
  }
  return source;
}

/**
 * basis 를 수량으로 평가 — 측정·구간·항목 셀 참조를 resolver 로 연다.
 *
 * 측정 소스는 원장(measurements)에 있으면 최신값으로 평가되지만, 원장이 비어 있거나
 * 측정이 아직 재연결 안 된 경우(예: .scube 복원 직후)를 대비해 소스 캐시값을 폴백으로
 * 넣어 준다 — 셀 참조 basis 라도 조립 시점 수치가 살아 있게 한다.
 * 미해결 참조(순환·삭제·결측 캐시)는 NaN 으로 남긴다(조용히 잘못된 값 금지).
 */
function evaluateItemQuantity(
  basis: FormulaNode,
  source: TakeoffSource,
  sections: StationSection[],
  measurements: readonly Measurement[],
  allItems: EditableTakeoffItem[],
): number {
  const itemQuantities = new Map(allItems.map((it) => [it.id, it.quantity]));
  const extraValues = new Map<string, number>();
  if (source.kind === 'measurement') {
    // 측정이 원장에 없을 때의 폴백(원장에 있으면 buildRefResolver 가 최신값으로 덮어씀).
    extraValues.set(measurementValueKey(source.measurementId), source.value);
  }
  if (isDerivedSource(source)) {
    // 파생 소스: 기준 단면 폴리라인에서 산출한 둘레/바닥면적을 셀값으로 공급(RW-5).
    for (const [key, value] of derivedGeometryValues(source)) {
      extraValues.set(key, value);
    }
  }
  const resolver = buildRefResolver({ sections, measurements, itemQuantities, extraValues });
  try {
    return evaluateQuantity(basis, resolver);
  } catch {
    // 미해결 참조(순환·삭제) → NaN (조용히 잘못된 값 금지)
    return Number.NaN;
  }
}

/**
 * 전 항목 재계산 (P4-10) — 원본(측정·구간·규격) 변경 시 basis·quantity 갱신.
 *
 * 의존 순서: 비참조(측정·구간·수동)를 먼저 평가해 수량을 확정하고, 참조(ref) 항목을
 * 그 결과로 평가한다. 참조가 참조를 물면(2단계 이상) 한 패스로 부족할 수 있으므로
 * 항목 수만큼 반복하되 값이 안정되면 조기 종료한다(순환은 NaN 으로 남는다).
 */
export function recomputeItems(
  items: EditableTakeoffItem[],
  specs: MaterialSpec[],
  sections: StationSection[],
  measurements: readonly Measurement[] = [],
): EditableTakeoffItem[] {
  const specByCode = new Map(specs.map((s) => [s.code, s]));

  // 1패스: 비참조 항목 확정 (측정·구간·수동 — 원본 최신값 흡수).
  let current = items.map((it) =>
    it.source.kind === 'ref'
      ? it
      : reassembleItem(it, specByCode.get(it.specCode), sections, items, measurements),
  );

  // 2..N패스: 참조 항목 평가 — 값이 더 안 바뀔 때까지(최대 항목 수) 반복.
  const maxPasses = items.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = current.map((it) =>
      it.source.kind === 'ref'
        ? reassembleItem(it, specByCode.get(it.specCode), sections, current, measurements)
        : it,
    );
    if (quantitiesEqual(current, next)) return next;
    current = next;
  }
  return current;
}

/** 두 항목 배열의 수량이 (NaN 포함) 동일한지 — 재계산 수렴 판정 */
function quantitiesEqual(a: EditableTakeoffItem[], b: EditableTakeoffItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]?.quantity;
    const y = b[i]?.quantity;
    if (x === undefined || y === undefined) return false;
    // NaN === NaN 은 false 이므로 둘 다 NaN 이면 같음으로 취급.
    if (Number.isNaN(x) && Number.isNaN(y)) continue;
    if (x !== y) return false;
  }
  return true;
}

/**
 * schema TakeoffItem[] → EditableTakeoffItem[] (프로젝트 복원, Phase 4-D).
 *
 * .scube 는 편집용 source 메타를 담지 않으므로, 저장된 basis·quantity 를 그대로 보존하는
 * 수동 소스(manual)로 되살린다 — 산출근거 트리(basis)와 값(quantity)이 그대로 렌더·재export
 * 된다. 원본(측정·구간) 재연결은 사용자가 소스를 다시 지정하면 재개된다.
 */
export function restoreEditableItems(
  items: TakeoffItem[],
  specs: MaterialSpec[],
): EditableTakeoffItem[] {
  const specByCode = new Map(specs.map((s) => [s.code, s]));
  return items.map((it) => {
    const spec = specByCode.get(it.specCode);
    return {
      id: it.id,
      workType: it.workType,
      name: spec?.name ?? it.specCode,
      specCode: spec !== undefined ? it.specCode : '',
      unit: it.unit,
      // 저장된 값을 보존하는 수동 소스 — basis 는 원본 트리를 유지한다(라벨은 복원 안내).
      source: { kind: 'manual', value: it.quantity, label: '복원값' },
      basis: it.basis,
      quantity: it.quantity,
      blocked: false,
      sourceRefs: it.sourceRefs,
    };
  });
}

/**
 * EditableTakeoffItem → schema TakeoffItem (저장·엑셀 export 용).
 * basis 가 null(차단)이면 null 을 돌려 호출 측이 export 에서 제외·경고하게 한다
 * (차단 항목을 조용히 0 으로 저장하지 않는다).
 */
export function toTakeoffItem(item: EditableTakeoffItem): TakeoffItem | null {
  if (item.basis === null) return null;
  return {
    id: item.id,
    workType: item.workType,
    specCode: item.specCode !== '' ? item.specCode : item.name,
    unit: item.unit,
    ...(item.calcType !== undefined ? { calcType: item.calcType } : {}),
    quantity: item.quantity,
    basis: item.basis,
    sourceRefs: item.sourceRefs,
  };
}
