import type { FormulaNode, Segment, Station } from '@s-cube/schema';
import { sectionLength } from '../quantity/calc.ts';
import { evaluate, fAdd, fConst, fDiv, fMul } from '../quantity/formula.ts';
import { sortSections } from './sort.ts';

/**
 * 구간 생성 + 체적 (03-DATA-MODEL §4, P3-6·P3-7·P3-9).
 *
 * 정렬된 단면을 인접 쌍으로 묶어 Segment 를 만든다.
 * 전/후 불연속(§4)을 정확히 구현한다:
 *   동일 chainage 에 pre/post 공존 시 —
 *     앞 구간의 종점 = pre 단면, 뒤 구간의 시점 = post 단면,
 *     pre↔post 사이 length_m = 0 (체적 0, 중복 계상 금지).
 *   pre 단면의 area 가 결측이면 SegmentError 로 승격 (산출 차단, 조용히 0 처리 금지).
 */

/**
 * buildSegments 입력 단면.
 *
 * StationSection 과 동일하되 area_m2 를 선택적으로 둔다 —
 * 전/후 불연속에서 (전) 단면이 측정 누락(결측)일 수 있음을 표현하기 위함.
 * area_m2 가 undefined 인 단면은 체적 산출에 쓸 수 없고, 필요한 구간에서
 * SegmentError 로 승격된다 (곡성 No.8+0.000(전) 절토량 누락 재발 방지).
 */
export interface SectionInput {
  id: string;
  station: Station;
  itemKey: string;
  /** 단면적 (㎡). undefined 면 결측 — 산출에 사용 불가 */
  area_m2?: number;
  measurementId?: string;
  note?: string;
  /** 각주법용 중앙 단면적 (㎡) — 제공 시에만 원뿔대 공식에 사용 */
  midArea_m2?: number;
}

/** 구간 생성 오류 사유 */
export const SEGMENT_ERROR_REASONS = [
  /** 전/후 불연속의 (전) 단면 값 결측 → 산출 차단 */
  'pre-section-missing-area',
  /** 짝이 없는 단면 (구간을 이룰 인접 단면 없음) */
  'orphan-section',
  /** 각주법 요청이나 중앙 단면(Am) 미제공 → 평균단면법 근사로 대체됨 안내 */
  'prismoidal-missing-mid',
] as const;

export type SegmentErrorReason = (typeof SEGMENT_ERROR_REASONS)[number];

/** 구간 생성 오류 — 조용히 넘기지 않고 errors 로 노출 */
export interface SegmentError {
  reason: SegmentErrorReason;
  itemKey: string;
  /** 문제가 발생한 chainage (해당 시) */
  chainage_m: number;
  /** 사람이 읽는 사유 (한국어) */
  message: string;
  /** 관련 단면 id (있으면) */
  sectionIds: string[];
}

export interface BuildSegmentsOptions {
  /** true 면 짝 없는 단면(orphan)을 오류로 표시 (기본 true) */
  flagOrphans?: boolean;
}

export interface BuildSegmentsResult {
  segments: Segment[];
  errors: SegmentError[];
  /**
   * 산출 차단 여부 (03-DATA-MODEL §4).
   *
   * true 면 이 항목(itemKey)에 결측 승격 에러가 있어 총 체적을 신뢰할 수 없다.
   * segments 에는 정상 구간만 담겨 있어 '부분합'이 조용히 새어나갈 수 있으므로,
   * 소비자는 blocked 를 반드시 확인해 부분 체적을 표시·저장·export 하지 말아야 한다.
   * blocked 를 계산 계층에 못박아, '막는' 책임을 UI 가 아니라 이 함수가 진다.
   *
   * 승격(차단) 에러: 'pre-section-missing-area'.
   * 비차단(안내) 에러: 'orphan-section'·'prismoidal-missing-mid' 는 blocked 를 올리지 않는다.
   */
  blocked: boolean;
}

/** 산출을 차단하는(승격) 에러 사유 — 부분합이 조용히 새지 않도록 blocked 판정에 사용 */
const BLOCKING_REASONS: ReadonlySet<SegmentErrorReason> = new Set<SegmentErrorReason>([
  'pre-section-missing-area',
]);

/** 차단 에러가 하나라도 있으면 true (blocked) */
function hasBlockingError(errors: SegmentError[]): boolean {
  return errors.some((e) => BLOCKING_REASONS.has(e.reason));
}

const AVERAGE_END_AREA = 'average-end-area' as const;
const PRISMOIDAL = 'prismoidal' as const;

/**
 * 각주법(원뿔대) 체적식 FormulaNode.
 *   V = L/6 × (A1 + 4·Am + A2)
 * Am(중앙 단면적) 이 제공될 때만 사용한다. 미제공 시 호출 측에서
 * 평균단면법으로 대체하고 SegmentError('prismoidal-missing-mid') 로 안내한다.
 */
export function prismoidalVolume(
  a1_m2: number,
  midArea_m2: number,
  a2_m2: number,
  length_m: number,
): FormulaNode {
  return fMul(
    fDiv(fConst(length_m, 'L(m)'), fConst(6, '6')),
    fAdd(
      fConst(a1_m2, 'A1(㎡)'),
      fMul(fConst(4, '4'), fConst(midArea_m2, 'Am(㎡)')),
      fConst(a2_m2, 'A2(㎡)'),
    ),
  );
}

/**
 * 한 구간의 체적 FormulaNode 를 만든다.
 * - average-end-area: sectionLength(a1,a2,L) 재사용 (=(A1+A2)/2×L).
 * - prismoidal: midArea_m2 제공 시 V=L/6×(A1+4Am+A2), 미제공 시 평균단면법 대체.
 */
export function segmentVolume(
  a1_m2: number,
  a2_m2: number,
  length_m: number,
  method: 'average-end-area' | 'prismoidal',
  midArea_m2?: number,
): FormulaNode {
  if (method === PRISMOIDAL && midArea_m2 !== undefined) {
    return prismoidalVolume(a1_m2, midArea_m2, a2_m2, length_m);
  }
  // 평균단면법 (또는 Am 미제공 각주법 대체)
  return sectionLength(a1_m2, a2_m2, length_m);
}

/** 두 단면이 전/후 불연속 쌍(같은 chainage, pre→post)인지 */
function isDiscontinuityPair(a: SectionInput, b: SectionInput): boolean {
  return (
    a.station.chainage_m === b.station.chainage_m &&
    a.station.discontinuity === 'pre' &&
    b.station.discontinuity === 'post'
  );
}

/**
 * 인접 측점 쌍으로 Segment 를 생성한다 (P3-9).
 *
 * @param sections 단면 목록 (여러 itemKey 혼재 가능 — itemKey 로 필터)
 * @param itemKey  산출 대상 항목 (절토·성토 등)
 * @param method   양단면평균법 또는 각주법
 * @param opts     옵션 (orphan 표시 여부)
 */
export function buildSegments(
  sections: SectionInput[],
  itemKey: string,
  method: 'average-end-area' | 'prismoidal',
  opts?: BuildSegmentsOptions,
): BuildSegmentsResult {
  const flagOrphans = opts?.flagOrphans ?? true;
  const errors: SegmentError[] = [];

  // 해당 itemKey 만 골라 chainage 정렬 (pre→null→post).
  // sortSections 는 SortableSection 최소 형태만 요구하므로 SectionInput 을
  // 그대로 넘긴다 (area_m2 결측 허용, 캐스팅 불필요).
  const filtered = sections.filter((s) => s.itemKey === itemKey);
  const sorted = sortSections(filtered);

  if (sorted.length === 1 && flagOrphans) {
    const only = sorted[0];
    if (only !== undefined) {
      errors.push({
        reason: 'orphan-section',
        itemKey,
        chainage_m: only.station.chainage_m,
        message: `단면이 하나뿐이라 구간을 만들 수 없습니다 (chainage ${only.station.chainage_m}m, ${itemKey})`,
        sectionIds: [only.id],
      });
    }
  }

  const segments: Segment[] = [];

  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === undefined || to === undefined) {
      continue;
    }

    const length_m = to.station.chainage_m - from.station.chainage_m;
    const pair = isDiscontinuityPair(from, to);

    // 전/후 불연속 쌍: pre↔post 사이는 연장 0, 체적 0 (중복 계상 금지).
    if (pair) {
      // (전) 단면 area 결측 → 에러로 승격, 산출 차단.
      if (from.area_m2 === undefined) {
        errors.push({
          reason: 'pre-section-missing-area',
          itemKey,
          chainage_m: from.station.chainage_m,
          message: `전/후 불연속의 (전) 단면 값이 비어 있습니다 — 산출을 차단합니다 (chainage ${from.station.chainage_m}m, ${itemKey})`,
          sectionIds: [from.id],
        });
        // 산출 차단: 이 구간의 Segment 를 만들지 않는다 (조용히 0 처리 금지).
        continue;
      }
      // 연장 0 → 체적 0. a2 는 post 단면(to) 자신 — post 결측을 from 값으로
      // 조용히 대체하지 않는다(연장 0 이라 체적에는 영향 없으나, a2 표시가
      // 실제 값과 달라지는 조용한 왜곡을 막는다). post 결측이면 a2 = 0 으로 둔다.
      const a1 = from.area_m2;
      const a2 = to.area_m2 ?? 0;
      const volume_m3 = 0;
      segments.push({
        from: from.station,
        to: to.station,
        length_m: 0,
        itemKey,
        a1,
        a2,
        volume_m3,
        method,
      });
      continue;
    }

    // 일반 구간. 시점·종점 단면 area 결측 검사.
    if (from.area_m2 === undefined) {
      errors.push({
        reason: 'pre-section-missing-area',
        itemKey,
        chainage_m: from.station.chainage_m,
        message: `시점 단면 값이 비어 있습니다 — 산출을 차단합니다 (chainage ${from.station.chainage_m}m, ${itemKey})`,
        sectionIds: [from.id],
      });
      continue;
    }
    if (to.area_m2 === undefined) {
      errors.push({
        reason: 'pre-section-missing-area',
        itemKey,
        chainage_m: to.station.chainage_m,
        message: `종점 단면 값이 비어 있습니다 — 산출을 차단합니다 (chainage ${to.station.chainage_m}m, ${itemKey})`,
        sectionIds: [to.id],
      });
      continue;
    }

    const a1 = from.area_m2;
    const a2 = to.area_m2;

    // 각주법인데 Am 미제공 → 평균단면법 대체 + 안내.
    let effectiveMethod: 'average-end-area' | 'prismoidal' = method;
    const mid: number | undefined = to.midArea_m2 ?? from.midArea_m2;
    if (method === PRISMOIDAL && mid === undefined) {
      effectiveMethod = AVERAGE_END_AREA;
      errors.push({
        reason: 'prismoidal-missing-mid',
        itemKey,
        chainage_m: to.station.chainage_m,
        message: `각주법에 필요한 중앙 단면(Am)이 없어 평균단면법으로 대체합니다 (chainage ${from.station.chainage_m}~${to.station.chainage_m}m, ${itemKey})`,
        sectionIds: [from.id, to.id],
      });
    }

    const node = segmentVolume(a1, a2, length_m, effectiveMethod, mid);
    const volume_m3 = evaluate(node);

    segments.push({
      from: from.station,
      to: to.station,
      length_m,
      itemKey,
      a1,
      a2,
      volume_m3,
      method: effectiveMethod,
    });
  }

  return { segments, errors, blocked: hasBlockingError(errors) };
}

/**
 * 항목 총 체적 (03-DATA-MODEL §4).
 *
 * blocked(결측 승격) 이면 null 을 반환한다 — '정상 구간의 부분합'을 조용히
 * 돌려주지 않는다(곡성류 재발 방지). blocked 가 아니면 정상 구간 체적의 합을
 * full precision 으로 반환한다(내부 반올림 없음, 표시 시점에만 반올림).
 *
 * BuildSegmentsResult 를 그대로 받아 소비자가 errors/blocked 를 우회할 수 없게 한다.
 */
export function totalVolume(result: BuildSegmentsResult): number | null {
  if (result.blocked) {
    return null;
  }
  let sum = 0;
  for (const seg of result.segments) {
    sum += seg.volume_m3;
  }
  return sum;
}
