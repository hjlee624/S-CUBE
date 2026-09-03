/**
 * 프로젝트 액션 (내보내기·저장·열기) — 수량산출서 xlsx 내보내기 + .scube 저장/열기.
 *
 * 내보내기 전 검증(P4-11): 경고가 있으면 window.confirm 으로 확인 후 진행(강제 차단 아님).
 * 기존 TakeoffDock 에 있던 로직을 그대로 옮겨 QuantityWorkbench(내보내기 탭)에서 재사용한다.
 */
import { useState } from 'react';
import { exportWorkbook, validateBeforeExport } from '../lib/export-xlsx.ts';
import { pickProjectFile, saveProjectFile } from '../lib/project-file.ts';
import { useAppStore } from '../store/index.ts';

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
        unsupportedCounts: d.model.unsupportedCounts,
        sanitizedCount: d.model.sanitizedCount,
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
