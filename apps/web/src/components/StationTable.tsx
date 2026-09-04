/**
 * 측점 테이블 (P3-11·P3-12·P3-15) — 행: 측점, 열: 항목(itemKey)별 단면적.
 *
 * - 측점 raw 인라인 편집 → parseStation 즉시 반영. 파싱 실패는 빨강 에러로 표시(조용히 넘기지 않음).
 * - 셀 단면적 인라인 편집(수동) + 측정값 '할당' 흐름(P3-12): 활성 도면 측정을 셀에 연결.
 * - 이상 감지 배지(P3-15): 면적0/음수·급변 단면에 amber 경고.
 * - 항목 추가/이름변경, 측점 행 추가/삭제.
 *
 * 계산은 lib/station-derive.ts 순수 함수로만 하고 이 컴포넌트는 수식을 갖지 않는다.
 */
import type { Station, StationSection } from '@s-cube/schema';
import { useMemo, useState } from 'react';
import { formatArea, formatChainage } from '../lib/format.ts';
import { measurementsForDrawing } from '../lib/measure.ts';
import {
  type Anomaly,
  detectAnomalies,
  isStationParseError,
  parseStation,
} from '../lib/station-derive.ts';
import { useAppStore } from '../store/index.ts';

/** 한 측점 행에 묶이는 단면들 — chainage_m + discontinuity + raw 로 그룹 */
interface StationRow {
  key: string;
  raw: string;
  chainage_m: number;
  discontinuity: 'pre' | 'post' | null;
  parseOk: boolean;
  parseReason: string | null;
  /** itemKey → 해당 단면 (없으면 undefined) */
  byItem: Map<string, StationSection>;
}

/** 측점 단면들을 (raw+discontinuity) 기준으로 행 그룹핑하고 chainage 정렬 */
function groupRows(sections: StationSection[], stationInterval_m: number): StationRow[] {
  const map = new Map<string, StationRow>();
  for (const sec of sections) {
    const rawKey = `${sec.station.raw}__${sec.station.discontinuity ?? 'null'}`;
    let row = map.get(rawKey);
    if (row === undefined) {
      const parsed = parseStation(sec.station.raw, stationInterval_m);
      const ok = !isStationParseError(parsed);
      row = {
        key: rawKey,
        raw: sec.station.raw,
        chainage_m: sec.station.chainage_m,
        discontinuity: sec.station.discontinuity,
        parseOk: ok,
        parseReason: isStationParseError(parsed) ? parsed.reason : null,
        byItem: new Map(),
      };
      map.set(rawKey, row);
    }
    row.byItem.set(sec.itemKey, sec);
  }
  return [...map.values()].sort((a, b) => {
    const dc = a.chainage_m - b.chainage_m;
    if (dc !== 0) return dc;
    const rank = (d: 'pre' | 'post' | null) => (d === 'pre' ? 0 : d === null ? 1 : 2);
    return rank(a.discontinuity) - rank(b.discontinuity);
  });
}

/** 불연속 배지 라벨 */
function discLabel(d: 'pre' | 'post' | null): string | null {
  if (d === 'pre') return '전';
  if (d === 'post') return '후';
  return null;
}

/** 단면적 셀 — 인라인 편집 + 도면 취득 대상 지정 + 측정 할당 + 이상 배지 */
function AreaCell({
  section,
  anomaly,
  onEditArea,
  onAssign,
  assignableCount,
  isTarget,
  onToggleTarget,
}: {
  section: StationSection | undefined;
  anomaly: Anomaly | undefined;
  onEditArea: (area_m2: number) => void;
  onAssign: () => void;
  assignableCount: number;
  /** 이 셀이 도면 면적 취득 대상(클릭 자동기입) 셀인가 */
  isTarget: boolean;
  onToggleTarget: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    setEditing(false);
    const n = Number.parseFloat(draft);
    if (Number.isFinite(n)) onEditArea(n);
  };

  const hasValue = section !== undefined;
  // 누적 취득(여러 폐합영역 합산) 개수 — 2 이상이면 배지로 노출.
  const sourceCount = section?.sourceMeasurementIds?.length ?? 0;
  const badgeTone = isTarget
    ? 'border-orange-500/70 bg-orange-500/10 ring-1 ring-orange-500/40'
    : anomaly !== undefined
      ? 'border-amber-700/60 bg-amber-950/25'
      : hasValue
        ? 'border-zinc-800 bg-zinc-900/40'
        : 'border-dashed border-zinc-800 bg-transparent';

  return (
    <td className="px-1.5 py-1 align-top">
      <div className={`rounded-md border px-2 py-1 transition-colors duration-150 ${badgeTone}`}>
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: 셀 진입 즉시 타이핑 UX
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded border border-emerald-700/60 bg-zinc-950 px-1 py-0.5 text-right font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500"
          />
        ) : (
          <button
            type="button"
            title="클릭: 단면적 직접 입력"
            onClick={() => {
              setDraft(section !== undefined ? String(section.area_m2) : '');
              setEditing(true);
            }}
            className={`block w-full text-right font-mono text-[11px] tabular-nums ${
              hasValue
                ? 'text-emerald-300 hover:text-emerald-200'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {hasValue ? formatArea(section.area_m2) : '입력'}
          </button>
        )}

        <div className="mt-0.5 flex items-center justify-between gap-1">
          {/* 취득 대상 토글 — 도면 영역 클릭 시 이 셀에 자동 기입 */}
          <button
            type="button"
            onClick={onToggleTarget}
            title={
              isTarget
                ? '취득 대상 해제 (도면 클릭 자동기입 중지)'
                : '이 셀을 도면 면적 취득 대상으로 — 도면에서 영역 클릭 시 자동 기입(Shift 누적)'
            }
            className={`rounded px-1.5 py-px text-[9px] font-semibold transition-colors duration-150 ${
              isTarget
                ? 'bg-orange-500/25 text-orange-300'
                : 'bg-zinc-800 text-zinc-400 hover:bg-orange-500/15 hover:text-orange-300'
            }`}
          >
            {isTarget ? '◉ 취득중' : '◎ 취득'}
          </button>

          {/* 측정 출처 표시 — 누적이면 영역 개수 */}
          {sourceCount > 1 ? (
            <span
              className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-400"
              title={`${sourceCount}개 폐합영역 합산`}
            >
              {sourceCount}영역
            </span>
          ) : section?.measurementId !== undefined ? (
            <span
              className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-400"
              title={`측정 출처: ${section.measurementId}`}
            >
              측정
            </span>
          ) : (
            <span className="text-[9px] text-zinc-600">{hasValue ? '수동' : ''}</span>
          )}

          {/* 측정 할당 버튼 — 활성 도면 면적 측정이 있을 때만 */}
          {assignableCount > 0 && (
            <button
              type="button"
              onClick={onAssign}
              title="활성 도면의 면적 측정값을 이 셀에 할당"
              className="rounded bg-zinc-800 px-1.5 py-px text-[9px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-emerald-500/20 hover:text-emerald-300"
            >
              할당
            </button>
          )}
        </div>

        {anomaly !== undefined && (
          <p className="mt-0.5 text-[9px] leading-tight text-amber-400" title={anomaly.reason}>
            ⚠ {anomaly.kind === 'area-jump' ? '급변' : '면적이상'}
          </p>
        )}
      </div>
    </td>
  );
}

export function StationTable() {
  const sections = useAppStore((s) => s.sections);
  const itemKeys = useAppStore((s) => s.itemKeys);
  const stationInterval_m = useAppStore((s) => s.stationInterval_m);
  const measurements = useAppStore((s) => s.measurements);
  const activeId = useAppStore((s) => s.activeId);
  const selectedMeasurementIds = useAppStore((s) => s.selectedMeasurementIds);
  const activeStationId = useAppStore((s) => s.activeStationId);
  const activeItemKey = useAppStore((s) => s.activeItemKey);
  const setAreaTargetCell = useAppStore((s) => s.setAreaTargetCell);
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const calibration = useAppStore((s) => s.calibration);

  const addSection = useAppStore((s) => s.addSection);
  const removeSection = useAppStore((s) => s.removeSection);
  const updateSectionArea = useAppStore((s) => s.updateSectionArea);
  const updateSectionRaw = useAppStore((s) => s.updateSectionRaw);
  const assignMeasurementToSection = useAppStore((s) => s.assignMeasurementToSection);
  const addItemKey = useAppStore((s) => s.addItemKey);
  const renameItemKey = useAppStore((s) => s.renameItemKey);
  const setStationInterval = useAppStore((s) => s.setStationInterval);
  const showToast = useAppStore((s) => s.showToast);

  const drawings = useAppStore((s) => s.drawings);

  const [newRaw, setNewRaw] = useState('');
  const [newItem, setNewItem] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  const rows = useMemo(() => groupRows(sections, stationInterval_m), [sections, stationInterval_m]);

  // RW-4: 활성 도면의 TEXT 엔티티 중 parseStation 성공하는 값을 측점 후보로 추출.
  // 이미 등록된 측점은 제외해 중복 추가를 막는다.
  const stationSuggestions = useMemo(() => {
    const activeDrawing = drawings.find((d) => d.id === activeId);
    if (activeDrawing == null) return [];
    const existingRaws = new Set(rows.map((r) => r.raw));
    const seen = new Set<string>();
    const candidates: { raw: string; chainage_m: number }[] = [];
    for (const entity of activeDrawing.model.entities) {
      if (entity.kind !== 'text') continue;
      const raw = entity.value.trim();
      if (seen.has(raw) || existingRaws.has(raw)) continue;
      const parsed = parseStation(raw, stationInterval_m);
      if (!isStationParseError(parsed)) {
        seen.add(raw);
        candidates.push({ raw, chainage_m: parsed.chainage_m });
      }
    }
    return candidates.sort((a, b) => a.chainage_m - b.chainage_m).map((c) => c.raw);
  }, [drawings, activeId, rows, stationInterval_m]);

  // itemKey 별 이상 목록 → sectionId 로 인덱싱해 셀 배지에 매칭.
  const anomalyBySection = useMemo(() => {
    const map = new Map<string, Anomaly>();
    for (const key of itemKeys) {
      for (const an of detectAnomalies(sections, key, stationInterval_m)) {
        if (an.sectionId !== undefined && !map.has(an.sectionId)) map.set(an.sectionId, an);
      }
    }
    return map;
  }, [sections, itemKeys, stationInterval_m]);

  // 할당 후보: 활성 도면의 면적 측정 (선택된 것 우선).
  const areaMeasurements = useMemo(
    () => measurementsForDrawing(measurements, activeId).filter((m) => m.kind === 'area'),
    [measurements, activeId],
  );

  const addRow = () => {
    const raw = newRaw.trim();
    if (raw === '') return;
    const parsed = parseStation(raw, stationInterval_m);
    if (isStationParseError(parsed)) {
      showToast(`측점 파싱 실패: ${parsed.reason}`, 'error');
      return;
    }
    const { ok: _ok, ...station } = parsed;
    const firstItem = itemKeys[0] ?? '절토';
    addSection({
      id: crypto.randomUUID(),
      station,
      itemKey: firstItem,
      area_m2: 0,
    });
    setNewRaw('');
  };

  /**
   * 새 단면 생성 시 station 을 결정한다 (정합 보장).
   *
   * no/plus_m 를 0 으로 하드코딩하면 setStationInterval 재파싱 때 raw(예: No.8+0.000)와
   * no=0 가정이 어긋나 같은 측점 행인데 단면마다 no/plus_m 가 달라진다. 그래서:
   *   1) 같은 행(byItem)의 기존 단면 station 을 그대로 재사용(no/plus_m 정합 보장),
   *   2) 없으면 row.raw 를 parseStation 으로 재파싱.
   * 재파싱도 실패하면 null — 호출 측에서 생성을 차단하고 토스트로 알린다.
   */
  const resolveStationForRow = (row: StationRow): Station | null => {
    const sibling = [...row.byItem.values()][0];
    if (sibling !== undefined) return sibling.station;
    const parsed = parseStation(row.raw, stationInterval_m);
    if (isStationParseError(parsed)) return null;
    const { ok: _ok, ...station } = parsed;
    return station;
  };

  /** 특정 (행,항목) 셀에 값을 넣는다 — 단면이 없으면 생성, 있으면 갱신 */
  const editCell = (row: StationRow, itemKey: string, area_m2: number) => {
    const existing = row.byItem.get(itemKey);
    if (existing !== undefined) {
      updateSectionArea(existing.id, area_m2);
      return;
    }
    const station = resolveStationForRow(row);
    if (station === null) {
      showToast(`측점 표기를 인식할 수 없어 셀을 만들 수 없습니다: ${row.raw}`, 'error');
      return;
    }
    addSection({
      id: crypto.randomUUID(),
      station,
      itemKey,
      area_m2,
    });
  };

  /** 측정 할당 — 선택된 면적 측정(없으면 첫 측정)을 셀에 연결 */
  const assignCell = (row: StationRow, itemKey: string) => {
    const picked =
      areaMeasurements.find((m) => selectedMeasurementIds.includes(m.id)) ?? areaMeasurements[0];
    if (picked === undefined) {
      showToast('할당할 면적 측정이 없습니다 — 먼저 도면에서 면적을 측정하세요', 'warn');
      return;
    }
    const existing = row.byItem.get(itemKey);
    if (existing !== undefined) {
      assignMeasurementToSection(existing.id, picked.id, picked.value);
      return;
    }
    const station = resolveStationForRow(row);
    if (station === null) {
      showToast(`측점 표기를 인식할 수 없어 셀을 만들 수 없습니다: ${row.raw}`, 'error');
      return;
    }
    addSection({
      id: crypto.randomUUID(),
      station,
      itemKey,
      area_m2: picked.value,
      measurementId: picked.id,
    });
    showToast(`'${picked.label}' 측정값을 ${row.raw} · ${itemKey} 에 할당했습니다`, 'success');
  };

  return (
    <div className="flex h-full flex-col">
      {/* 상단 컨트롤 — 측점 간격·항목 추가·행 추가 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5 text-zinc-400">
          측점 간격
          <input
            type="number"
            min={0.001}
            step={1}
            value={stationInterval_m}
            onChange={(e) => setStationInterval(Number.parseFloat(e.target.value))}
            className="w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-right font-mono text-zinc-200 outline-none focus:border-emerald-600"
          />
          <span className="text-zinc-600">m</span>
        </label>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              value={newRaw}
              placeholder="측점 (예: No.8+0.000(전))"
              onChange={(e) => setNewRaw(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addRow();
              }}
              className="w-48 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-zinc-200 outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              onClick={addRow}
              className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97]"
            >
              측점 추가
            </button>
          </div>
          {/* RW-4: 도면 TEXT 측점 후보 제안 — 포커스 시 또는 항상 표시 */}
          {stationSuggestions.length > 0 && (inputFocused || newRaw === '') && (
            <div className="flex flex-wrap gap-1">
              {stationSuggestions.slice(0, 12).map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setNewRaw(sug);
                  }}
                  title={`도면 TEXT에서 인식된 측점: ${sug}`}
                  className="rounded bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-300 transition-colors duration-100 hover:bg-emerald-500/20 hover:text-emerald-300"
                >
                  {sug}
                </button>
              ))}
              {stationSuggestions.length > 12 && (
                <span className="self-center text-[10px] text-zinc-600">
                  +{stationSuggestions.length - 12}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <input
            value={newItem}
            placeholder="항목 추가 (예: 암깎기)"
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newItem.trim() !== '') {
                addItemKey(newItem);
                setNewItem('');
              }
            }}
            className="w-36 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-zinc-200 outline-none focus:border-emerald-600"
          />
          <button
            type="button"
            onClick={() => {
              if (newItem.trim() !== '') {
                addItemKey(newItem);
                setNewItem('');
              }
            }}
            className="rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors duration-150 hover:border-emerald-700 hover:text-emerald-300"
          >
            항목 +
          </button>
        </div>
      </div>

      {/* RW-22: 도면 면적 취득 대상 안내 — 대상 셀 지정 시 도면 클릭으로 자동기입 */}
      {(() => {
        const targetSection =
          activeStationId !== null ? sections.find((s) => s.id === activeStationId) : undefined;
        if (targetSection === undefined || activeItemKey === null) return null;
        const measureReady = calibration !== null;
        return (
          <div className="flex flex-wrap items-center gap-2 border-b border-orange-500/20 bg-orange-500/5 px-3 py-1.5 text-[11px]">
            <span className="rounded-full bg-orange-500/20 px-2 py-0.5 font-semibold text-orange-300">
              취득 대상
            </span>
            <span className="font-mono text-zinc-200">
              {targetSection.station.raw} · {activeItemKey}
            </span>
            <span className="text-zinc-400">
              {measureReady
                ? activeTool === 'measure'
                  ? '도면에서 영역(폐합)을 클릭 → 자동 기입 · Shift+클릭으로 누적 합산'
                  : '측정 도구로 전환 후 도면 영역을 클릭하세요'
                : '먼저 캘리브레이션(축척)이 필요합니다'}
            </span>
            {measureReady && activeTool !== 'measure' && (
              <button
                type="button"
                onClick={() => setActiveTool('measure')}
                className="rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97]"
              >
                측정 도구 켜기
              </button>
            )}
            <button
              type="button"
              onClick={() => setAreaTargetCell(null, null)}
              className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-200"
            >
              대상 해제
            </button>
          </div>
        );
      })()}

      {/* 테이블 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-zinc-500">
            측점을 추가하면 항목별 단면적을 입력하고 체적이 자동으로 계산됩니다.
          </p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-semibold">측점</th>
                <th className="px-3 py-2 text-right font-semibold">chainage</th>
                {itemKeys.map((key) => (
                  <th key={key} className="px-1.5 py-2 text-right font-semibold">
                    <ItemHeader itemKey={key} onRename={(to) => renameItemKey(key, to)} />
                  </th>
                ))}
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const anyItem = [...row.byItem.values()][0];
                const anchorId = anyItem?.id ?? null;
                // 이 행에 취득 대상 셀이 있는가 — 앵커 id 가 활성 대상과 일치.
                const rowActive = activeStationId !== null && activeStationId === anchorId;
                return (
                  <tr
                    key={row.key}
                    className={`animate-row-in border-t border-zinc-900 hover:bg-zinc-900/30 ${
                      rowActive ? 'bg-orange-500/5' : ''
                    }`}
                  >
                    {/* 측점 raw — 인라인 편집 + 파싱 상태 */}
                    <td className="px-3 py-1 align-top">
                      <RawCell
                        raw={row.raw}
                        parseOk={row.parseOk}
                        parseReason={row.parseReason}
                        discontinuity={row.discontinuity}
                        onEdit={(next) => {
                          if (anyItem !== undefined) updateSectionRaw(anyItem.id, next);
                        }}
                      />
                    </td>
                    <td className="px-3 py-1 text-right align-top font-mono text-[11px] tabular-nums text-zinc-400">
                      {row.parseOk ? formatChainage(row.chainage_m) : '—'}
                    </td>
                    {itemKeys.map((key) => {
                      const sec = row.byItem.get(key);
                      const isTarget =
                        anchorId !== null &&
                        activeStationId === anchorId &&
                        activeItemKey === key;
                      return (
                        <AreaCell
                          key={key}
                          section={sec}
                          anomaly={sec !== undefined ? anomalyBySection.get(sec.id) : undefined}
                          assignableCount={areaMeasurements.length}
                          onEditArea={(area) => editCell(row, key, area)}
                          onAssign={() => assignCell(row, key)}
                          isTarget={isTarget}
                          onToggleTarget={() => {
                            if (isTarget) setAreaTargetCell(null, null);
                            else if (anchorId !== null) setAreaTargetCell(anchorId, key);
                          }}
                        />
                      );
                    })}
                    <td className="px-1 py-1 text-center align-top">
                      <button
                        type="button"
                        title="이 측점 행 삭제"
                        onClick={() => {
                          for (const sec of row.byItem.values()) removeSection(sec.id);
                        }}
                        className="rounded p-0.5 text-zinc-600 transition-colors duration-150 hover:bg-zinc-800 hover:text-red-400"
                      >
                        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                          <path
                            d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 측점 raw 셀 — 인라인 편집·파싱 실패 빨강 표시·불연속 배지 */
function RawCell({
  raw,
  parseOk,
  parseReason,
  discontinuity,
  onEdit,
}: {
  raw: string;
  parseOk: boolean;
  parseReason: string | null;
  discontinuity: 'pre' | 'post' | null;
  onEdit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(raw);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== '' && next !== raw) onEdit(next);
    else setDraft(raw);
  };

  const label = discLabel(discontinuity);

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: 인라인 편집 즉시 타이핑 UX
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setDraft(raw);
            setEditing(false);
          }
        }}
        className="w-40 rounded border border-emerald-700/60 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500"
      />
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        title="클릭: 측점 표기 편집"
        onClick={() => {
          setDraft(raw);
          setEditing(true);
        }}
        className={`font-mono text-[11px] ${parseOk ? 'text-zinc-200 hover:text-emerald-300' : 'text-red-400 hover:text-red-300'}`}
      >
        {raw}
      </button>
      {label !== null && (
        <span
          className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${
            discontinuity === 'pre'
              ? 'bg-sky-500/15 text-sky-300'
              : 'bg-violet-500/15 text-violet-300'
          }`}
        >
          {label}
        </span>
      )}
      {!parseOk && (
        <span
          className="rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-semibold text-red-300"
          title={parseReason ?? '파싱 실패'}
        >
          파싱 오류
        </span>
      )}
    </div>
  );
}

/** 항목 헤더 — 더블클릭 이름 변경 */
function ItemHeader({ itemKey, onRename }: { itemKey: string; onRename: (to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(itemKey);

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: 인라인 편집 즉시 타이핑 UX
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== '' && draft.trim() !== itemKey) onRename(draft.trim());
          else setDraft(itemKey);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(itemKey);
            setEditing(false);
          }
        }}
        className="w-20 rounded border border-emerald-700/60 bg-zinc-950 px-1 py-0.5 text-right text-[10px] text-zinc-100 outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      title="더블클릭: 항목 이름 변경"
      onDoubleClick={() => {
        setDraft(itemKey);
        setEditing(true);
      }}
      className="text-emerald-300/90 hover:text-emerald-200"
    >
      {itemKey}
    </button>
  );
}
