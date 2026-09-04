/**
 * 측점 슬라이스 (Phase 3-C) — 프로젝트 단위 측점·단면 상태.
 *
 * 측점은 도면별이 아니라 프로젝트 산출 단위다(ScubeProject.sections 와 일치).
 * 따라서 도면 전환(activeId 변경)과 독립적으로 보존된다 — 캘리브레이션·측정 슬라이스와
 * 달리 drawingId 태깅을 하지 않는다.
 *
 * 파생(정렬·구간·이상)은 selector/메모에서 lib/station-derive.ts 순수 함수로 계산한다.
 * 순수 상태 전이(단면 추가·단면적 수정·삭제·측정 할당·항목/간격 설정)는 아래 순수 함수로
 * 분리해 테스트한다. 이 슬라이스는 canvas 를 import 하지 않는다.
 */
import type { Station, StationSection } from '@s-cube/schema';
import type { StateCreator } from 'zustand';
import { parseStation } from '../lib/station-derive.ts';
import type { AppState, StationSlice } from './types.ts';

/** 기본 측점 간격 (m) — 통상 20 (03-DATA-MODEL §7 stationInterval_m) */
export const DEFAULT_STATION_INTERVAL_M = 20;

/** 기본 항목(itemKey) — 토공 산출의 대표 3종 */
export const DEFAULT_ITEM_KEYS = ['절토', '성토', '표토제거'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 순수 상태 전이 (테스트 대상)
// ─────────────────────────────────────────────────────────────────────────────

/** 단면 추가 — 배열 끝에 append (순수) */
export function addSection(list: StationSection[], section: StationSection): StationSection[] {
  return [...list, section];
}

/** 단면 제거 — 해당 id 만 제거 (순수) */
export function removeSection(list: StationSection[], id: string): StationSection[] {
  return list.filter((s) => s.id !== id);
}

/**
 * 단면적 수정 — 해당 id 의 area_m2 를 교체 (순수).
 * 수동 입력이므로 measurementId 연결은 끊는다(도면 출처가 아닌 사용자 값이 됨).
 */
export function updateSectionArea(
  list: StationSection[],
  id: string,
  area_m2: number,
): StationSection[] {
  return list.map((s) => {
    if (s.id !== id) return s;
    const { measurementId, ...rest } = s;
    return { ...rest, area_m2 };
  });
}

/**
 * 측정값을 단면에 할당 (P3-12) — 해당 id 의 area_m2·measurementId 를 함께 설정 (순수).
 * 도면 측정 출처를 연결하면서 값(㎡)을 반영한다.
 */
export function assignMeasurement(
  list: StationSection[],
  id: string,
  measurementId: string,
  area_m2: number,
): StationSection[] {
  return list.map((s) => (s.id === id ? { ...s, measurementId, area_m2 } : s));
}

/**
 * 면적 취득값을 대상 (측점,itemKey) 셀에 기입/누적 (순수, RW-22).
 *
 * 도면에서 폐합 영역을 클릭하면 그 면적(㎡)이 이 함수를 통해 대상 셀에 들어간다.
 * - additive=false: 이 측정값으로 교체(단일 영역 취득).
 * - additive=true : 기존 area_m2 에 더하고 sourceMeasurementIds 에 append(누적 선택 — 여러
 *   폐합 영역을 합산). 역추적을 위해 기여한 모든 측정 id 를 보존한다.
 * 대상 (측점,itemKey) 셀이 없으면 새 단면을 생성한다.
 */
export function accumulateSectionArea(
  list: StationSection[],
  params: {
    station: Station;
    itemKey: string;
    addValue: number;
    measurementId: string;
    additive: boolean;
    newSectionId: string;
  },
): { sections: StationSection[]; total_m2: number; sourceCount: number } {
  const { station, itemKey, addValue, measurementId, additive, newSectionId } = params;
  const target = list.find(
    (s) =>
      s.itemKey === itemKey &&
      s.station.raw === station.raw &&
      s.station.discontinuity === station.discontinuity,
  );
  if (target === undefined) {
    const section: StationSection = {
      id: newSectionId,
      station,
      itemKey,
      area_m2: addValue,
      measurementId,
      sourceMeasurementIds: [measurementId],
    };
    return { sections: [...list, section], total_m2: addValue, sourceCount: 1 };
  }
  const priorSources = additive
    ? (target.sourceMeasurementIds ??
      (target.measurementId !== undefined ? [target.measurementId] : []))
    : [];
  const total_m2 = (additive ? target.area_m2 : 0) + addValue;
  const sources = [...priorSources, measurementId];
  const sections = list.map((s) =>
    s.id === target.id
      ? { ...s, area_m2: total_m2, measurementId: sources[0], sourceMeasurementIds: sources }
      : s,
  );
  return { sections, total_m2, sourceCount: sources.length };
}

/** 단면의 측점 원표기(raw) 수정 — 재파싱해 station 갱신 (순수) */
export function updateSectionRaw(
  list: StationSection[],
  id: string,
  raw: string,
  stationInterval_m: number,
): StationSection[] {
  const parsed = parseStation(raw, stationInterval_m);
  if (parsed.ok === false) {
    // 파싱 실패 시에도 raw 는 반영해 테이블에 에러로 표시되게 한다.
    // 실패 시 station.raw 만 바꾸고 나머지 chainage 등은 이전 값을 유지(표시가 에러 배지로 갈림).
    return list.map((s) => (s.id === id ? { ...s, station: { ...s.station, raw } } : s));
  }
  const { ok: _ok, ...station } = parsed;
  return list.map((s) => (s.id === id ? { ...s, station } : s));
}

/** 항목(itemKey) 추가 — 중복이면 무시 (순수) */
export function addItemKey(keys: string[], key: string): string[] {
  const trimmed = key.trim();
  if (trimmed === '' || keys.includes(trimmed)) return keys;
  return [...keys, trimmed];
}

/** 항목 이름 변경 — keys 목록과 해당 itemKey 단면들을 함께 갱신 (순수) */
export function renameItemKey(
  keys: string[],
  sections: StationSection[],
  from: string,
  to: string,
): { itemKeys: string[]; sections: StationSection[] } {
  const trimmed = to.trim();
  if (trimmed === '' || from === trimmed || keys.includes(trimmed)) {
    return { itemKeys: keys, sections };
  }
  return {
    itemKeys: keys.map((k) => (k === from ? trimmed : k)),
    sections: sections.map((s) => (s.itemKey === from ? { ...s, itemKey: trimmed } : s)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 슬라이스
// ─────────────────────────────────────────────────────────────────────────────

export const createStationSlice: StateCreator<AppState, [], [], StationSlice> = (set, get) => ({
  stationInterval_m: DEFAULT_STATION_INTERVAL_M,
  sections: [],
  itemKeys: [...DEFAULT_ITEM_KEYS],

  // 측점·단면 변경은 전부 구간 체적 산출의 원본이므로, 변경 뒤 하위 항목을 재계산한다
  // (P4-10 '원본 측정 수정 시 하위 전부 갱신'). recomputeTakeoff 는 set 이후 최신 sections
  // 를 읽어 basis·quantity 를 다시 조립한다.
  addSection: (section) => {
    set((s) => ({ sections: addSection(s.sections, section) }));
    get().recomputeTakeoff();
    get().addHistoryEntry({
      actor: get().author || '사용자',
      kind: 'section',
      targetId: section.id,
      detail: `단면 추가: ${section.station.raw}`,
    });
  },

  removeSection: (id) => {
    const sec = get().sections.find((s) => s.id === id);
    set((s) => ({ sections: removeSection(s.sections, id) }));
    get().recomputeTakeoff();
    if (sec !== undefined) {
      get().addHistoryEntry({
        actor: get().author || '사용자',
        kind: 'section',
        targetId: id,
        detail: `단면 삭제: ${sec.station.raw}`,
      });
    }
  },

  updateSectionArea: (id, area_m2) => {
    set((s) => ({ sections: updateSectionArea(s.sections, id, area_m2) }));
    get().recomputeTakeoff();
  },

  assignMeasurementToSection: (id, measurementId, area_m2) => {
    set((s) => ({ sections: assignMeasurement(s.sections, id, measurementId, area_m2) }));
    get().recomputeTakeoff();
  },

  acquireAreaIntoCell: ({ anchorSectionId, itemKey, area_m2, measurementId, additive }) => {
    const anchor = get().sections.find((s) => s.id === anchorSectionId);
    const station = anchor?.station;
    if (station === undefined) return null;
    const result = accumulateSectionArea(get().sections, {
      station,
      itemKey,
      addValue: area_m2,
      measurementId,
      additive,
      newSectionId: crypto.randomUUID(),
    });
    set({ sections: result.sections });
    get().recomputeTakeoff();
    get().addHistoryEntry({
      actor: get().author || '사용자',
      kind: 'section',
      detail: `면적 취득: ${station.raw} · ${itemKey} ${result.total_m2.toFixed(2)}㎡${
        result.sourceCount > 1 ? ` (${result.sourceCount}영역 합산)` : ''
      }`,
    });
    return { total_m2: result.total_m2, sourceCount: result.sourceCount };
  },

  updateSectionRaw: (id, raw) => {
    set((s) => ({ sections: updateSectionRaw(s.sections, id, raw, s.stationInterval_m) }));
    get().recomputeTakeoff();
  },

  setStationInterval: (interval_m) => {
    if (!Number.isFinite(interval_m) || interval_m <= 0) return;
    // 간격이 바뀌면 기존 단면들의 chainage 가 달라지므로 raw 로 되파싱한다
    // (raw 가 진실의 원천 — 표시 chainage 는 파생값).
    set((s) => ({
      stationInterval_m: interval_m,
      sections: s.sections.map((sec) => {
        const parsed = parseStation(sec.station.raw, interval_m);
        if (parsed.ok === false) return sec;
        const { ok: _ok, ...station } = parsed;
        return { ...sec, station };
      }),
    }));
    // 간격 변경은 구간 연장(chainage 차)을 바꿔 체적을 바꾸므로 재계산.
    get().recomputeTakeoff();
  },

  addItemKey: (key) => set((s) => ({ itemKeys: addItemKey(s.itemKeys, key) })),

  renameItemKey: (from, to) => {
    set((s) => renameItemKey(s.itemKeys, s.sections, from, to));
    // itemKey 이름이 바뀌면 segment-volume 소스(itemKey 기준)의 대상 구간이 달라지므로 재계산.
    get().recomputeTakeoff();
  },
});
