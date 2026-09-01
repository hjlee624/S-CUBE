/**
 * 산출 하단 도크 (Phase 4) — 규격 마스터 / 산출 항목 탭 + 수량산출서·프로젝트 저장 액션.
 *
 * StationDock 과 같은 하단 도크 패턴(탭·접힘 토글·panel-bottom 진입)을 따른다. 측점 도크와
 * 별도로 두어 각 도크가 자기 관심사(측점/체적 vs 규격/항목)를 담는다. 내보내기·저장 전
 * 검증 경고는 클릭 시 확인 후 진행한다(강제 차단 아님, 사용자 선택).
 */
import { useState } from 'react';
import { exportWorkbook, validateBeforeExport } from '../lib/export-xlsx.ts';
import { pickProjectFile, saveProjectFile } from '../lib/project-file.ts';
import type { TakeoffDockTab } from '../store/index.ts';
import { useAppStore } from '../store/index.ts';
import { SpecMaster } from './SpecMaster.tsx';
import { TakeoffEditor } from './TakeoffEditor.tsx';

const TABS: { id: TakeoffDockTab; label: string }[] = [
  { id: 'items', label: '산출 항목' },
  { id: 'specs', label: '규격 마스터' },
];

export function TakeoffDock() {
  const open = useAppStore((s) => s.takeoffDockOpen);
  const tab = useAppStore((s) => s.takeoffDockTab);
  const toggle = useAppStore((s) => s.toggleTakeoffDock);
  const setTab = useAppStore((s) => s.setTakeoffDockTab);
  const itemCount = useAppStore((s) => s.items.length);

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={toggle}
          className="mr-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-300 transition-colors duration-150 hover:bg-zinc-900"
          aria-expanded={open}
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          수량 산출
          <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium tabular-nums text-zinc-400">
            {itemCount}
          </span>
        </button>

        {open &&
          TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'animate-tool-pop bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            );
          })}

        {/* 산출/저장 액션 — 우측 정렬 */}
        <div className="ml-auto flex items-center gap-1.5">
          <ProjectActions />
        </div>
      </div>

      {open && (
        <div className="h-72 animate-panel-bottom border-t border-zinc-900">
          {tab === 'items' && <TakeoffEditor />}
          {tab === 'specs' && <SpecMaster />}
        </div>
      )}
    </div>
  );
}

/** 수량산출서 내보내기 · .scube 저장/열기 액션 (검증 경고 포함) */
export function ProjectActions() {
  const showToast = useAppStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    const state = useAppStore.getState();
    // 내보내기 전 검증 (P4-11 연동) — 경고가 있으면 확인 후 진행(사용자 선택).
    const warnings = validateBeforeExport({
      drawings: state.drawings.map((d) => ({
        fileName: d.fileName,
        calibration: d.id === state.activeId ? state.calibration : d.calibration,
      })),
      sections: state.sections,
      itemKeys: state.itemKeys,
      items: state.items,
    });
    if (warnings.length > 0) {
      const proceed = window.confirm(
        `내보내기 전 확인:\n\n${warnings.map((w) => `• ${w.message}`).join('\n')}\n\n그래도 진행할까요?`,
      );
      if (!proceed) return;
    }
    setBusy(true);
    const result = await exportWorkbook(useAppStore.getState());
    setBusy(false);
    if (result.ok) {
      showToast(`수량산출서 내보내기 완료 — ${result.fileName}`, 'success');
    } else {
      showToast(result.message, result.reason === 'no-builder' ? 'warn' : 'error');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={pickProjectFile}
        className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
        title=".scube 프로젝트 열기"
      >
        열기
      </button>
      <button
        type="button"
        onClick={saveProjectFile}
        className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
        title="현재 상태를 .scube 로 저장"
      >
        저장(.scube)
      </button>
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={busy}
        className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97] disabled:cursor-wait disabled:opacity-60"
        title="수량산출서 xlsx 내보내기"
      >
        {busy ? '생성 중…' : '수량산출서 내보내기'}
      </button>
    </>
  );
}
