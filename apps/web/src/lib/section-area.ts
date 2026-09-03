/**
 * 단면적 취득 순수 로직 (P3-13) — 원지반선·계획선 2프로파일 → 절토/성토 단면적(㎡) →
 * 활성 측점 자동 기입 계획.
 *
 * 반자동 철학의 핵심: 사람은 도면에서 원지반선·계획선을 클릭만 하고, 면적 계산·축척²·
 * 절토/성토 분류·측점 셀 기입은 전부 이 순수 로직 + 오케스트레이터(canvas/actions.ts)가 한다.
 *
 * 정확성 핵심:
 * - core areaBetweenProfiles 는 **도면 단위²** 를 반환한다.
 * - 미터² 변환은 여기서 applyScaleToRaw(kind='area', scale) 로 **축척의 제곱**을 곱해 1회만.
 * - cut → '절토' itemKey, fill → '성토' itemKey 로 라우팅한다.
 *
 * canvas·store 에 의존하지 않는 순수 함수만 둔다(단위 테스트 대상). 부수효과(측정 생성·
 * addSection·assignMeasurementToSection 호출)는 canvas/actions.ts 오케스트레이터가 수행한다.
 */
import type { Measurement, NEntity, PVertex, Station, StationSection } from '@s-cube/schema';
import { areaBetweenProfiles } from './core-api.ts';
import { applyScaleToRaw, buildMeasurement } from './measure.ts';

/** 절토/성토 표준 itemKey — core·측점 슬라이스 DEFAULT_ITEM_KEYS 와 일치해야 한다. */
export const CUT_ITEM_KEY = '절토';
export const FILL_ITEM_KEY = '성토';

/** 단면적 취득 결과 — 축척² 적용 후 미터², + 도면 단위² 원값(검증·역산) + 경고. */
export interface SectionAreaResult {
  /** 절토 단면적 (㎡) — 축척² 적용 후 */
  cut_m2: number;
  /** 성토 단면적 (㎡) — 축척² 적용 후 */
  fill_m2: number;
  /** 순 단면적 (㎡) = cut − fill */
  net_m2: number;
  /** 절토 도면 단위² 원값 (Measurement.rawValue) */
  cutRaw: number;
  /** 성토 도면 단위² 원값 (Measurement.rawValue) */
  fillRaw: number;
  /** 공통 x 구간 [min,max] (도면 단위) — 겹침 없으면 null */
  overlapRange: [number, number] | null;
  /** core + web 경고(비단일값·겹침없음·양쪽 0 등) */
  warnings: string[];
}

/**
 * 엔티티에서 프로파일 정점열을 추출한다 — 순수.
 * - line: 2점 폴리라인(bulge 0)으로 취급.
 * - polyline: vertices 그대로(arc 포함 bulge 는 core 가 평탄화).
 * - 그 외(hatch·circle·arc·text·dimension): 프로파일 대상이 아님 → null.
 *
 * arc 단독 엔티티는 열린 곡선이나 프로파일(횡단선)로는 폴리라인/라인만 취급한다(요구사항 §1).
 */
export function extractProfileVertices(entity: NEntity): PVertex[] | null {
  if (entity.kind === 'line') {
    return [
      { p: { x: entity.a.x, y: entity.a.y }, bulge: 0 },
      { p: { x: entity.b.x, y: entity.b.y }, bulge: 0 },
    ];
  }
  if (entity.kind === 'polyline') {
    // 정점 2개 미만이면 프로파일이 될 수 없다.
    if (entity.vertices.length < 2) return null;
    return entity.vertices;
  }
  return null;
}

/**
 * 원지반선·계획선 정점열 → 절토/성토 단면적(㎡) — 순수.
 *
 * core areaBetweenProfiles 로 도면 단위² cut/fill 을 얻은 뒤, applyScaleToRaw 로 축척의
 * **제곱**을 곱해 미터²로 환산한다(면적 축척² 필수). rawValue(도면 단위²)는 그대로 보존한다.
 */
export function computeSectionAreas(
  ground: PVertex[],
  design: PVertex[],
  scale_mPerUnit: number,
): SectionAreaResult {
  const raw = areaBetweenProfiles(ground, design);
  const cut_m2 = applyScaleToRaw(raw.cut_m2, 'area', scale_mPerUnit);
  const fill_m2 = applyScaleToRaw(raw.fill_m2, 'area', scale_mPerUnit);
  const warnings = [...raw.warnings];
  if (raw.cut_m2 === 0 && raw.fill_m2 === 0 && raw.overlapRange !== null) {
    warnings.push('절토·성토 단면적이 모두 0 입니다 — 두 선이 겹쳐 있거나 교차만 할 수 있습니다.');
  }
  return {
    cut_m2,
    fill_m2,
    net_m2: cut_m2 - fill_m2,
    cutRaw: raw.cut_m2,
    fillRaw: raw.fill_m2,
    overlapRange: raw.overlapRange,
    warnings,
  };
}

/** 단면 측정 조립 입력 — 절토/성토 한 쪽 */
export interface BuildSectionMeasurementInput {
  id: string;
  drawingId: string;
  /** 도면 단위² 원값 (cutRaw 또는 fillRaw) */
  rawValue: number;
  /** 절토(cut)/성토(fill) 구분 — Measurement.cutFill 로 보존 */
  cutFill: 'cut' | 'fill';
  /** [원지반선.handle, 계획선.handle] — 감사·역추적 키 */
  sourceHandles: string[];
  label: string;
  createdAt: string;
}

/**
 * 단면적 Measurement 조립 — 순수. method='profile-cut-fill', kind='area'.
 *
 * FR-3.10 step 4: 2클릭 절토/성토 취득 경로는 method='profile-cut-fill' 로 태깅해
 * 감사·역추적에서 일반 entity-chain(P2-6 선·원호 체인) 측정과 구별한다. 어느 쪽(절토/성토)
 * 인지는 cutFill 필드로 보존한다.
 * value(㎡)는 buildMeasurement 가 rawValue × scale² 로 계산한다(축척² 1회).
 */
export function buildSectionMeasurement(
  input: BuildSectionMeasurementInput,
  scale_mPerUnit: number,
): Measurement {
  return buildMeasurement(
    {
      id: input.id,
      drawingId: input.drawingId,
      kind: 'area',
      rawValue: input.rawValue,
      method: 'profile-cut-fill',
      cutFill: input.cutFill,
      sourceHandles: input.sourceHandles,
      label: input.label,
      createdAt: input.createdAt,
    },
    scale_mPerUnit,
  );
}

/**
 * 활성 측점(앵커 단면 id)이 가리키는 측점(station)을 역추적한다 — 순수.
 * 앵커 id 의 단면이 없으면 null(측점 미선택·삭제됨).
 */
export function resolveActiveStation(
  sections: readonly StationSection[],
  activeStationId: string | null,
): Station | null {
  if (activeStationId === null) return null;
  const anchor = sections.find((s) => s.id === activeStationId);
  return anchor?.station ?? null;
}

/** 한 측점·itemKey 단면 기입 계획 — 생성 또는 갱신 중 하나. */
export type SectionWritePlan =
  | {
      op: 'assign';
      /** 갱신 대상 기존 단면 id */
      sectionId: string;
      measurementId: string;
      area_m2: number;
      itemKey: string;
    }
  | {
      op: 'create';
      section: StationSection;
      itemKey: string;
    };

/** 절토·성토 자동 기입 전체 계획 */
export interface SectionAssignmentPlan {
  /** 생성할 Measurement 들(절토·성토 중 기입 대상만) */
  measurements: Measurement[];
  /** 각 (측점,itemKey) 셀 기입 지시 */
  writes: SectionWritePlan[];
}

/** planSectionAssignments 입력 — id/시각은 호출부(부수효과)가 주입 */
export interface PlanSectionInput {
  station: Station;
  drawingId: string;
  groundHandle: string;
  designHandle: string;
  result: SectionAreaResult;
  scale_mPerUnit: number;
  /** 현재 전체 단면(대상 (측점,itemKey) 존재 여부 판정) */
  sections: readonly StationSection[];
  /** 측점 표기(토스트) */
  stationLabel: string;
  createdAt: string;
  /** 절토 Measurement id (crypto.randomUUID 주입) */
  cutMeasurementId: string;
  /** 성토 Measurement id */
  fillMeasurementId: string;
  /** 절토 단면 생성 시 id */
  cutSectionId: string;
  /** 성토 단면 생성 시 id */
  fillSectionId: string;
}

/**
 * 한 쪽(절토 또는 성토)의 기입 계획을 만든다 — 순수 내부 헬퍼.
 * rawValue==0 이면 셀을 만들지 않는다(0인 쪽은 생성 안 함 — 요구사항 §2 판단).
 * 대상 (station, itemKey) 단면이 있으면 assign(갱신), 없으면 create.
 */
function planOneSide(params: {
  itemKey: string;
  cutFill: 'cut' | 'fill';
  rawValue: number;
  measurementId: string;
  newSectionId: string;
  station: Station;
  sourceHandles: string[];
  drawingId: string;
  label: string;
  scale_mPerUnit: number;
  sections: readonly StationSection[];
  createdAt: string;
}): { measurement: Measurement; write: SectionWritePlan } | null {
  if (params.rawValue === 0) return null;
  const measurement = buildSectionMeasurement(
    {
      id: params.measurementId,
      drawingId: params.drawingId,
      rawValue: params.rawValue,
      cutFill: params.cutFill,
      sourceHandles: params.sourceHandles,
      label: params.label,
      createdAt: params.createdAt,
    },
    params.scale_mPerUnit,
  );
  // 같은 측점(raw+불연속)·같은 itemKey 단면을 찾는다.
  const existing = params.sections.find(
    (s) =>
      s.itemKey === params.itemKey &&
      s.station.raw === params.station.raw &&
      s.station.discontinuity === params.station.discontinuity,
  );
  if (existing !== undefined) {
    return {
      measurement,
      write: {
        op: 'assign',
        sectionId: existing.id,
        measurementId: measurement.id,
        area_m2: measurement.value,
        itemKey: params.itemKey,
      },
    };
  }
  return {
    measurement,
    write: {
      op: 'create',
      itemKey: params.itemKey,
      section: {
        id: params.newSectionId,
        station: params.station,
        itemKey: params.itemKey,
        area_m2: measurement.value,
        measurementId: measurement.id,
      },
    },
  };
}

/**
 * 절토·성토 자동 기입 계획을 만든다 — 순수(부수효과 없음).
 *
 * cut → '절토', fill → '성토'. 각 쪽에 Measurement(profile-cut-fill, cutFill 구분,
 * sourceHandles=[원지반,계획])를 만들고, 해당 (측점,itemKey) 단면이 있으면 assign, 없으면 create 로 지시한다.
 * rawValue 0 인 쪽은 셀을 만들지 않는다(측정도 생성하지 않음).
 */
export function planSectionAssignments(input: PlanSectionInput): SectionAssignmentPlan {
  const sourceHandles = [input.groundHandle, input.designHandle];
  const measurements: Measurement[] = [];
  const writes: SectionWritePlan[] = [];

  const cut = planOneSide({
    itemKey: CUT_ITEM_KEY,
    cutFill: 'cut',
    rawValue: input.result.cutRaw,
    measurementId: input.cutMeasurementId,
    newSectionId: input.cutSectionId,
    station: input.station,
    sourceHandles,
    drawingId: input.drawingId,
    label: `${CUT_ITEM_KEY} 단면 ${input.stationLabel}`,
    scale_mPerUnit: input.scale_mPerUnit,
    sections: input.sections,
    createdAt: input.createdAt,
  });
  if (cut !== null) {
    measurements.push(cut.measurement);
    writes.push(cut.write);
  }

  const fill = planOneSide({
    itemKey: FILL_ITEM_KEY,
    cutFill: 'fill',
    rawValue: input.result.fillRaw,
    measurementId: input.fillMeasurementId,
    newSectionId: input.fillSectionId,
    station: input.station,
    sourceHandles,
    drawingId: input.drawingId,
    label: `${FILL_ITEM_KEY} 단면 ${input.stationLabel}`,
    scale_mPerUnit: input.scale_mPerUnit,
    sections: input.sections,
    createdAt: input.createdAt,
  });
  if (fill !== null) {
    measurements.push(fill.measurement);
    writes.push(fill.write);
  }

  return { measurements, writes };
}

/** 자동 기입 결과 토스트 문구 — "No.8 절토 12.50㎡ · 성토 3.20㎡ 자동 기입" */
export function formatSectionToast(stationLabel: string, result: SectionAreaResult): string {
  const parts: string[] = [];
  if (result.cutRaw !== 0) parts.push(`${CUT_ITEM_KEY} ${result.cut_m2.toFixed(2)}㎡`);
  if (result.fillRaw !== 0) parts.push(`${FILL_ITEM_KEY} ${result.fill_m2.toFixed(2)}㎡`);
  if (parts.length === 0) return `${stationLabel} 절토·성토 단면적이 0 입니다`;
  return `${stationLabel} ${parts.join(' · ')} 자동 기입`;
}
