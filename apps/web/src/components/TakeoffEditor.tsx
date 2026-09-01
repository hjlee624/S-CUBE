/**
 * 산출 항목 편집기 (Phase 4-B, P4-7~P4-10) — 항목 목록·추가·편집.
 *
 * 공종/규격(spec 선택)/단위 + 수량 소스 연결(측정값 / 구간 체적 / 수동입력 / 다른 항목 참조).
 * 산출근거를 renderText 로 미리보기(감리 확인용). 원본(측정·구간·규격) 변경 시 재계산.
 * blocked(전 결측) 구간을 소스로 하면 항목도 '산출 불가' 로 표시(곡성 일관성).
 * 계산·수식 조립은 lib/takeoff-* 순수 함수(→ core)로만 한다 — UI 는 수식을 쓰지 않는다.
 */
import { renderText } from '@s-cube/core';
import { useMemo, useState } from 'react';
import { formatMeasureValue, measurementsForDrawing } from '../lib/measure.ts';
import { buildSegments, totalVolume } from '../lib/station-derive.ts';
import { buildBasis, type TakeoffSource } from '../lib/takeoff-build.ts';
import type { EditableTakeoffItem, TakeoffDraft } from '../lib/takeoff-derive.ts';
import { useAppStore } from '../store/index.ts';

export function TakeoffEditor() {
  const items = useAppStore((s) => s.items);
  const removeTakeoffItem = useAppStore((s) => s.removeTakeoffItem);

  // 공종별 그룹 (대>중>세부는 workType 문자열로 표현).
  const groups = useMemo(() => {
    const byType = new Map<string, EditableTakeoffItem[]>();
    for (const it of items) {
      const list = byType.get(it.workType) ?? [];
      list.push(it);
      byType.set(it.workType, list);
    }
    return [...byType.entries()];
  }, [items]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AddItemForm />
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-600">
            산출 항목이 없습니다 — 위에서 규격과 수량 소스를 골라 추가하세요.
          </p>
        ) : (
          groups.map(([workType, list]) => (
            <section key={workType} className="mb-3 animate-fade-in-up">
              <h3 className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-emerald-300">
                {workType || '(공종 미지정)'}
                <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium tabular-nums text-zinc-400">
                  {list.length}
                </span>
              </h3>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-zinc-600">
                    <th className="px-1.5 py-1 font-semibold">명칭 / 규격</th>
                    <th className="px-1.5 py-1 font-semibold">소스</th>
                    <th className="px-1.5 py-1 font-semibold">산출근거</th>
                    <th className="px-1.5 py-1 text-right font-semibold">수량</th>
                    <th className="px-1.5 py-1 font-semibold">단위</th>
                    <th className="px-1.5 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((it) => (
                    <ItemRow key={it.id} item={it} onRemove={() => removeTakeoffItem(it.id)} />
                  ))}
                </tbody>
              </table>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const SOURCE_LABELS: Record<TakeoffSource['kind'], string> = {
  measurement: '측정값',
  'segment-volume': '구간 체적',
  manual: '수동 입력',
  ref: '항목 참조',
};

/** 산출 항목 한 행 — 산출근거 미리보기 + 차단 표시 */
function ItemRow({ item, onRemove }: { item: EditableTakeoffItem; onRemove: () => void }) {
  const spec = useAppStore((s) => s.specs.find((sp) => sp.code === item.specCode));
  const basisText = item.basis !== null ? renderText(item.basis) : null;

  return (
    <tr
      className={`animate-row-in border-t border-zinc-900 ${
        item.blocked ? 'bg-red-950/15' : 'hover:bg-zinc-900/30'
      }`}
    >
      <td className="px-1.5 py-1">
        <div className="font-medium text-zinc-200">{item.name}</div>
        <div className="font-mono text-[9px] text-zinc-500">{spec?.spec ?? item.specCode}</div>
      </td>
      <td className="px-1.5 py-1">
        <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium text-zinc-300">
          {SOURCE_LABELS[item.source.kind]}
        </span>
      </td>
      <td className="px-1.5 py-1">
        {item.blocked ? (
          <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-semibold text-red-300">
            산출 불가 (전 결측)
          </span>
        ) : (
          <code
            className="block max-w-[220px] truncate font-mono text-[10px] text-zinc-400"
            title={basisText ?? ''}
          >
            {basisText}
          </code>
        )}
      </td>
      <td className="px-1.5 py-1 text-right font-mono tabular-nums">
        {item.blocked || Number.isNaN(item.quantity) ? (
          <span className="text-red-400">—</span>
        ) : (
          <span className="text-emerald-300">{item.quantity.toFixed(3)}</span>
        )}
      </td>
      <td className="px-1.5 py-1 text-zinc-400">{item.unit}</td>
      <td className="px-1.5 py-1 text-right">
        <button
          type="button"
          onClick={onRemove}
          title="삭제"
          className="rounded px-1.5 py-0.5 text-zinc-600 transition-colors duration-150 hover:bg-red-950/40 hover:text-red-400"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

/** 항목 추가 폼 — 규격·공종·단위 + 수량 소스 선택 */
function AddItemForm() {
  const specs = useAppStore((s) => s.specs);
  const addTakeoffItem = useAppStore((s) => s.addTakeoffItem);
  const showToast = useAppStore((s) => s.showToast);

  const [specCode, setSpecCode] = useState('');
  const [sourceKind, setSourceKind] = useState<TakeoffSource['kind']>('measurement');

  const selectedSpec = specs.find((s) => s.code === specCode);

  const [manualValue, setManualValue] = useState('');
  const [measurementId, setMeasurementId] = useState('');
  const [segmentItemKey, setSegmentItemKey] = useState('');
  const [refItemIds, setRefItemIds] = useState<string[]>([]);

  const measurements = useAppStore((s) => s.measurements);
  const activeId = useAppStore((s) => s.activeId);
  const sections = useAppStore((s) => s.sections);
  const itemKeys = useAppStore((s) => s.itemKeys);
  const existingItems = useAppStore((s) => s.items);

  const activeMeasurements = useMemo(
    () => measurementsForDrawing(measurements, activeId),
    [measurements, activeId],
  );

  const buildDraftSource = (): TakeoffSource | null => {
    switch (sourceKind) {
      case 'measurement': {
        const m = activeMeasurements.find((x) => x.id === measurementId);
        if (m === undefined) return null;
        return {
          kind: 'measurement',
          measurementId: m.id,
          value: m.value,
          label: m.label,
          ...(selectedSpec?.calcType === 'area-thickness' ? { thickness_m: 0.1 } : {}),
        };
      }
      case 'segment-volume': {
        if (segmentItemKey === '') return null;
        return { kind: 'segment-volume', itemKey: segmentItemKey };
      }
      case 'manual': {
        const v = Number(manualValue);
        if (!Number.isFinite(v)) return null;
        return { kind: 'manual', value: v };
      }
      case 'ref': {
        if (refItemIds.length === 0) return null;
        return {
          kind: 'ref',
          refItemIds,
          refs: refItemIds.map((id) => {
            const t = existingItems.find((x) => x.id === id);
            return { itemId: id, label: t?.name ?? id, quantity: t?.quantity ?? 0 };
          }),
        };
      }
    }
  };

  const handleAdd = () => {
    const source = buildDraftSource();
    if (source === null) {
      showToast('수량 소스를 올바르게 지정하세요', 'warn');
      return;
    }
    const name = selectedSpec?.name ?? '항목';
    const workType = selectedSpec?.workType ?? '기타';
    const unit = selectedSpec?.unit ?? 'EA';
    const sourceRefs =
      source.kind === 'measurement' && activeId !== null
        ? [{ drawingId: activeId, handles: [] }]
        : [];
    const draft: TakeoffDraft = {
      id: crypto.randomUUID(),
      workType,
      name,
      specCode,
      unit,
      source,
      sourceRefs,
    };
    addTakeoffItem(draft);
    showToast(`'${name}' 항목 추가`, 'success');
    // 소스 입력 초기화 (규격 선택은 연속 추가 위해 유지)
    setManualValue('');
    setMeasurementId('');
  };

  return (
    <div className="shrink-0 border-b border-zinc-900 bg-zinc-900/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {/* 규격 선택 */}
        <select
          value={specCode}
          onChange={(e) => setSpecCode(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        >
          <option value="">규격 선택</option>
          {specs.map((s) => (
            <option key={s.code} value={s.code}>
              {s.workType} · {s.name} {s.spec}
            </option>
          ))}
        </select>

        {/* 소스 종류 */}
        <select
          value={sourceKind}
          onChange={(e) => setSourceKind(e.target.value as TakeoffSource['kind'])}
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        >
          <option value="measurement">측정값</option>
          <option value="segment-volume">구간 체적</option>
          <option value="manual">수동 입력</option>
          <option value="ref">항목 참조</option>
        </select>

        {/* 소스별 입력 */}
        {sourceKind === 'measurement' && (
          <select
            value={measurementId}
            onChange={(e) => setMeasurementId(e.target.value)}
            className="min-w-[140px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
          >
            <option value="">측정 선택 (활성 도면)</option>
            {activeMeasurements.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {formatMeasureValue(m.value, m.kind)}
              </option>
            ))}
          </select>
        )}
        {sourceKind === 'segment-volume' && (
          <SegmentSourcePicker
            sections={sections}
            itemKeys={itemKeys}
            value={segmentItemKey}
            onChange={setSegmentItemKey}
          />
        )}
        {sourceKind === 'manual' && (
          <input
            type="number"
            step="any"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="수량 직접 입력"
            className="w-32 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-right tabular-nums text-zinc-200 outline-none focus:border-emerald-700"
          />
        )}
        {sourceKind === 'ref' && (
          <select
            multiple
            value={refItemIds}
            onChange={(e) => setRefItemIds([...e.target.selectedOptions].map((o) => o.value))}
            className="min-w-[160px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
          >
            {existingItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.quantity.toFixed(2)})
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={handleAdd}
          className="ml-auto rounded-md bg-emerald-500 px-3 py-1 font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97]"
        >
          항목 추가
        </button>
      </div>

      {/* 실시간 산출근거 미리보기 (감리 확인용) */}
      <BasisPreview source={buildDraftSource()} spec={selectedSpec} sections={sections} />
    </div>
  );
}

/** 구간 체적 소스 선택 — itemKey 별 blocked 여부 표시(전 결측이면 산출 불가) */
function SegmentSourcePicker({
  sections,
  itemKeys,
  value,
  onChange,
}: {
  sections: ReturnType<typeof useAppStore.getState>['sections'];
  itemKeys: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const status = useMemo(() => {
    const map = new Map<string, { blocked: boolean; total: number | null }>();
    for (const key of itemKeys) {
      const result = buildSegments(sections, key);
      map.set(key, { blocked: result.blocked, total: totalVolume(result) });
    }
    return map;
  }, [sections, itemKeys]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[160px] rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
    >
      <option value="">측점 항목 선택</option>
      {itemKeys.map((key) => {
        const st = status.get(key);
        const label = st?.blocked
          ? `${key} — 산출 불가(전 결측)`
          : `${key} — ${st?.total !== null && st?.total !== undefined ? `${st.total.toFixed(2)} ㎥` : '구간 없음'}`;
        return (
          <option key={key} value={key}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

/** 산출근거 미리보기 — 조립 결과 basis 를 renderText 로 (blocked 면 경고) */
function BasisPreview({
  source,
  spec,
  sections,
}: {
  source: TakeoffSource | null;
  spec: ReturnType<typeof useAppStore.getState>['specs'][number] | undefined;
  sections: ReturnType<typeof useAppStore.getState>['sections'];
}) {
  const preview = useMemo(() => {
    if (source === null) return null;
    const basis = buildBasis(source, spec, sections);
    if (basis === null) return { blocked: true, text: '' };
    return { blocked: false, text: renderText(basis) };
  }, [source, spec, sections]);

  if (preview === null) {
    return (
      <p className="mt-1.5 text-[10px] text-zinc-600">
        규격과 수량 소스를 지정하면 산출근거가 미리 표시됩니다 (감리 확인용).
      </p>
    );
  }
  if (preview.blocked) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-red-300">
        <span className="rounded-full bg-red-500/15 px-1.5 py-px font-semibold">산출 불가</span>전
        결측 구간을 소스로 지정했습니다 — 누락 단면을 채운 뒤 추가하세요.
      </p>
    );
  }
  return (
    <div className="mt-1.5 flex items-start gap-2">
      <span className="mt-px text-[10px] font-semibold text-zinc-500">산출근거</span>
      <code className="font-mono text-[10px] text-emerald-300/90">{preview.text}</code>
    </div>
  );
}
