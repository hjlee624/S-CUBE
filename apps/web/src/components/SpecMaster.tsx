/**
 * 규격 마스터 UI (Phase 4-A, P4-1~P4-5) — 공종·규격·단위·환산계수·할증률 CRUD.
 *
 * 프리셋 로드(P4-2), 단위 환산(㎥→ton 등, P4-3), 할증률 편집(P4-4), JSON 가져오기/내보내기
 * (P4-5). 계산은 하지 않는다(환산·할증은 항목 조립 시 core 가 적용) — 여기서는 규격 기록만.
 * 디자인·모션 토큰 준수(패널·행 진입, emerald 액센트).
 */

import type { MaterialSpec } from '@s-cube/schema';
import { useMemo, useRef, useState } from 'react';
import { parseSpecsJson, serializeSpecsJson } from '../lib/spec-storage.ts';
import { useAppStore } from '../store/index.ts';

/** 새 규격 기본값 — 빈 폼 */
function blankSpec(): MaterialSpec {
  return { code: '', workType: '', name: '', spec: '', unit: '㎥', calcType: 'section-length' };
}

const CALC_TYPE_LABELS: Record<MaterialSpec['calcType'], string> = {
  'section-length': '단면적×연장(㎥)',
  'area-thickness': '면적×두께(㎥)',
  area: '면적(㎡)',
  'contact-length': '접촉길이(㎡)',
  length: '연장(m)',
  count: '개수(EA)',
  ref: '참조',
  manual: '수동',
};

export function SpecMaster() {
  const specs = useAppStore((s) => s.specs);
  const upsertSpec = useAppStore((s) => s.upsertSpec);
  const updateSpec = useAppStore((s) => s.updateSpec);
  const removeSpec = useAppStore((s) => s.removeSpec);
  const loadSpecPresets = useAppStore((s) => s.loadSpecPresets);
  const importSpecs = useAppStore((s) => s.importSpecs);
  const showToast = useAppStore((s) => s.showToast);
  const recomputeTakeoff = useAppStore((s) => s.recomputeTakeoff);

  const [draft, setDraft] = useState<MaterialSpec>(blankSpec);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 공종별 그룹 (대>중>세부는 workType 문자열로 표현) — 표시용 그룹핑.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? specs.filter(
          (s) =>
            s.workType.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.spec.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q),
        )
      : specs;
    const byType = new Map<string, MaterialSpec[]>();
    for (const s of filtered) {
      const list = byType.get(s.workType) ?? [];
      list.push(s);
      byType.set(s.workType, list);
    }
    return [...byType.entries()];
  }, [specs, filter]);

  const handleAdd = () => {
    if (draft.code.trim() === '' || draft.name.trim() === '') {
      showToast('규격 코드와 명칭은 필수입니다', 'warn');
      return;
    }
    upsertSpec(draft);
    recomputeTakeoff();
    showToast(`규격 '${draft.name}' 추가`, 'success');
    setDraft(blankSpec());
  };

  const handleExport = () => {
    const text = serializeSpecsJson(specs);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'specs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseSpecsJson(text);
    if (parsed === null) {
      showToast('규격 JSON 형식이 올바르지 않습니다', 'error');
      return;
    }
    importSpecs(parsed);
    recomputeTakeoff();
    showToast(`규격 ${parsed.length}개 가져오기`, 'success');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 도구 바 — 필터·프리셋·가져오기/내보내기 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="공종·규격·코드 검색"
          className="w-48 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-700"
        />
        <span className="text-[11px] tabular-nums text-zinc-500">{specs.length}개 규격</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              loadSpecPresets();
              recomputeTakeoff();
              showToast('사내 표준 프리셋 로드', 'success');
            }}
            className="rounded-md bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-all duration-150 hover:bg-zinc-700 active:scale-[0.97]"
          >
            프리셋 로드
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
          >
            내보내기
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
          >
            가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f !== undefined) void handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* 새 규격 추가 폼 */}
      <div className="grid shrink-0 grid-cols-[1fr_1.2fr_1fr_0.6fr_1fr_0.6fr_auto] items-center gap-1.5 border-b border-zinc-900 bg-zinc-900/30 px-3 py-2 text-[11px]">
        <input
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          placeholder="코드"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        />
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="명칭"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        />
        <input
          value={draft.spec}
          onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
          placeholder="규격"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        />
        <input
          value={draft.unit}
          onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          placeholder="단위"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        />
        <input
          value={draft.workType}
          onChange={(e) => setDraft({ ...draft, workType: e.target.value })}
          placeholder="공종"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200 outline-none focus:border-emerald-700"
        />
        <input
          type="number"
          step="0.01"
          value={draft.lossRate ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              lossRate: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          placeholder="할증"
          title="할증률 (0.03 = 3%)"
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-right tabular-nums text-zinc-200 outline-none focus:border-emerald-700"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="rounded-md bg-emerald-500 px-2.5 py-1 font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97]"
        >
          추가
        </button>
      </div>

      {/* 규격 목록 (공종 그룹) */}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-zinc-600">규격이 없습니다.</p>
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
                    <th className="px-1.5 py-1 font-semibold">단위</th>
                    <th className="px-1.5 py-1 font-semibold">계산유형</th>
                    <th className="px-1.5 py-1 text-right font-semibold">환산</th>
                    <th className="px-1.5 py-1 text-right font-semibold">할증</th>
                    <th className="px-1.5 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <SpecRow
                      key={s.code}
                      spec={s}
                      onUpdate={(patch) => {
                        updateSpec(s.code, patch);
                        recomputeTakeoff();
                      }}
                      onRemove={() => {
                        removeSpec(s.code);
                        recomputeTakeoff();
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          환산계수·할증률은 규격에 기록만 하고, 실제 적용(환산·할증)은 산출 항목이 산출근거 수식에
          반영합니다 (근거 유지 — 계산은 core 에서만).
        </p>
      </div>
    </div>
  );
}

/** 규격 한 행 — 인라인 편집(단위·환산·할증) */
function SpecRow({
  spec,
  onUpdate,
  onRemove,
}: {
  spec: MaterialSpec;
  onUpdate: (patch: Partial<MaterialSpec>) => void;
  onRemove: () => void;
}) {
  const conv = spec.conversions?.[0];
  return (
    <tr className="animate-row-in border-t border-zinc-900 hover:bg-zinc-900/30">
      <td className="px-1.5 py-1">
        <div className="font-medium text-zinc-200">{spec.name}</div>
        <div className="font-mono text-[9px] text-zinc-500">
          {spec.spec} · {spec.code}
        </div>
      </td>
      <td className="px-1.5 py-1">
        <input
          value={spec.unit}
          onChange={(e) => onUpdate({ unit: e.target.value })}
          className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-zinc-300 outline-none hover:border-zinc-800 focus:border-emerald-700"
        />
      </td>
      <td className="px-1.5 py-1 text-[10px] text-zinc-400">{CALC_TYPE_LABELS[spec.calcType]}</td>
      <td className="px-1.5 py-1 text-right">
        <div className="flex items-center justify-end gap-1">
          <input
            type="number"
            step="0.001"
            value={conv?.factor ?? ''}
            onChange={(e) => {
              const factor = e.target.value === '' ? undefined : Number(e.target.value);
              onUpdate({
                conversions:
                  factor === undefined
                    ? undefined
                    : [
                        {
                          toUnit: conv?.toUnit ?? 'TON',
                          factor,
                          ...(conv?.note ? { note: conv.note } : {}),
                        },
                      ],
              });
            }}
            placeholder="—"
            title="환산계수 (예: ㎥→TON 2.35)"
            className="w-14 rounded border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums text-zinc-300 outline-none hover:border-zinc-800 focus:border-emerald-700"
          />
          <input
            value={conv?.toUnit ?? ''}
            onChange={(e) => {
              const toUnit = e.target.value;
              if (conv === undefined) {
                onUpdate({ conversions: [{ toUnit, factor: 1 }] });
              } else {
                onUpdate({ conversions: [{ ...conv, toUnit }] });
              }
            }}
            placeholder="단위"
            className="w-10 rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] text-zinc-400 outline-none hover:border-zinc-800 focus:border-emerald-700"
          />
        </div>
      </td>
      <td className="px-1.5 py-1 text-right">
        <input
          type="number"
          step="0.01"
          value={spec.lossRate ?? ''}
          onChange={(e) =>
            onUpdate({ lossRate: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          placeholder="—"
          title="할증률 (0.03 = 3%)"
          className="w-12 rounded border border-transparent bg-transparent px-1 py-0.5 text-right tabular-nums text-zinc-300 outline-none hover:border-zinc-800 focus:border-emerald-700"
        />
      </td>
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
