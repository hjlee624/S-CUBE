/**
 * 측정 결과 패널 (P2-10·P2-11) — 활성 도면의 측정 목록·명명 편집·다중선택 합산·역추적.
 *
 * 표시만 반올림(면적 4자리·연장 3자리), 내부 값은 full precision(measure.ts formatMeasureValue).
 * 항목 클릭 → zoomToMeasurement(줌+하이라이트). Shift/Ctrl 클릭 → 다중선택 토글(합산 표시).
 * store가 canvas를 import하지 않는 구조 유지 — 캔버스 부수효과는 canvas/actions.ts 오케스트레이터 경유.
 */
import type { Measurement } from '@s-cube/schema';
import { useState } from 'react';
import { zoomToMeasurement } from '../canvas/actions.ts';
import { formatMeasureValue, measurementsForDrawing, sumMeasurements } from '../lib/measure.ts';
import { useAppStore } from '../store/index.ts';

/** method 표시 라벨 */
const METHOD_LABEL: Record<Measurement['method'], string> = {
  polyline: '폴리라인',
  hatch: 'HATCH',
  'auto-boundary': '자동경계',
  'entity-chain': '엔티티체인',
  'profile-cut-fill': '절토/성토',
  dimension: '치수',
  manual: '수동',
};

function MeasureRow({
  m,
  selected,
  onSelect,
  onToggle,
  onRelabel,
  onRemove,
}: {
  m: Measurement;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRelabel: (label: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.label);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next.length > 0 && next !== m.label) onRelabel(next);
    else setDraft(m.label);
  };

  return (
    <li
      className={`group animate-row-in rounded-lg border p-2.5 text-xs transition-all duration-150 ${
        selected
          ? 'border-emerald-700/60 bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* 명명 — 인라인 편집 */}
        {editing ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: 인라인 편집 진입 시 즉시 타이핑 UX
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') {
                setDraft(m.label);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-emerald-700/60 bg-zinc-950 px-1.5 py-0.5 font-medium text-zinc-100 outline-none focus:border-emerald-500"
          />
        ) : (
          <button
            type="button"
            title="클릭: 도면에서 위치 찾기 · Shift/Ctrl: 다중선택 · 더블클릭: 이름 변경"
            onClick={(e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) onToggle();
              else onSelect();
            }}
            onDoubleClick={() => {
              setDraft(m.label);
              setEditing(true);
            }}
            className="min-w-0 flex-1 truncate text-left font-medium text-zinc-200 hover:text-emerald-300"
          >
            {m.label}
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title="측정 삭제"
          aria-label={`${m.label} 삭제`}
          className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-all duration-150 hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
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
      </div>

      {/* 값 + 단위 (표시 자리수 정책) */}
      <div className="mt-1.5 font-mono text-sm tabular-nums text-emerald-300">
        {formatMeasureValue(m.value, m.kind)}
      </div>

      {/* method · 출처(레이어는 handle로 역추적; handle 표기) */}
      <dl className="mt-1 space-y-0.5 font-mono text-[10px] text-zinc-500">
        <div className="flex justify-between">
          <dt>종류</dt>
          <dd className="text-zinc-400">{m.kind === 'area' ? '면적' : '연장'}</dd>
        </div>
        <div className="flex justify-between">
          <dt>취득</dt>
          <dd className="text-zinc-400">{METHOD_LABEL[m.method]}</dd>
        </div>
        <div className="flex justify-between">
          <dt>출처 handle</dt>
          <dd className="truncate text-zinc-400" title={m.sourceHandles.join(', ')}>
            {m.sourceHandles.join(', ') || '—'}
          </dd>
        </div>
        {m.holes !== undefined && m.holes.length > 0 && (
          <div className="flex justify-between">
            <dt>차감 구멍</dt>
            <dd className="text-amber-400">{m.holes.length}개</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

export function MeasurePanel() {
  const measurements = useAppStore((s) => s.measurements);
  const activeId = useAppStore((s) => s.activeId);
  const selectedIds = useAppStore((s) => s.selectedMeasurementIds);
  const removeMeasurement = useAppStore((s) => s.removeMeasurement);
  const updateLabel = useAppStore((s) => s.updateMeasurementLabel);
  const toggleSelection = useAppStore((s) => s.toggleMeasurementSelection);

  const list = measurementsForDrawing(measurements, activeId);
  if (list.length === 0) return null;

  const selectedList = list.filter((m) => selectedIds.includes(m.id));
  const sum = sumMeasurements(selectedList);

  return (
    <section className="animate-fade-in-up rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-zinc-300">측정</p>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 tabular-nums">
          {list.length}건
        </span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {list.map((m) => (
          <MeasureRow
            key={m.id}
            m={m}
            selected={selectedIds.includes(m.id)}
            onSelect={() => zoomToMeasurement(m.id)}
            onToggle={() => toggleSelection(m.id)}
            onRelabel={(label) => updateLabel(m.id, label)}
            onRemove={() => removeMeasurement(m.id)}
          />
        ))}
      </ul>

      {/* 다중선택 합산 — 선택 2건 이상이고 종류가 같을 때만 */}
      {selectedList.length >= 2 && (
        <div
          className={`mt-2.5 flex items-center justify-between rounded-md border px-2.5 py-1.5 ${
            sum !== null
              ? 'border-emerald-800/60 bg-emerald-950/30'
              : 'border-amber-800/50 bg-amber-950/20'
          }`}
        >
          <span className="text-[11px] text-zinc-400">선택 {selectedList.length}건 합계</span>
          {sum !== null ? (
            <span className="font-mono text-sm tabular-nums text-emerald-300">
              {formatMeasureValue(sum.total, sum.kind)}
            </span>
          ) : (
            <span className="text-[10px] text-amber-400">면적·연장 혼재 — 합산 불가</span>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
        항목 클릭 → 도면에서 위치 찾기. Shift/Ctrl 클릭 → 다중선택 합산. 더블클릭 → 이름 변경. 값은
        표시용으로만 반올림되고 내부는 정밀값을 유지합니다.
      </p>
    </section>
  );
}
