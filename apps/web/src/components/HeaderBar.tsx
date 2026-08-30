/**
 * 헤더 — 도면 열기, 도구 전환(팬/캘리브레이션/치수 대조), Zoom Extents.
 * 측정 도구는 Phase 2 예정 + 캘리브레이션 전 비활성 (P1-11).
 */
import { zoomToExtents } from '../canvas/actions.ts';
import { pickDxfFile } from '../lib/open-file.ts';
import type { ToolId } from '../store/index.ts';
import { useAppStore } from '../store/index.ts';

interface ToolDef {
  id: ToolId;
  label: string;
  hint: string;
}

const TOOLS: readonly ToolDef[] = [
  { id: 'pan', label: '이동', hint: '드래그로 팬 · 휠로 줌' },
  { id: 'calibrate', label: '캘리브레이션', hint: '2점 클릭 → 실제 거리 입력' },
  { id: 'dim-check', label: '치수 대조', hint: 'DIMENSION 클릭 → 오차 확인' },
];

export function HeaderBar() {
  const model = useAppStore((s) => s.model);
  const activeTool = useAppStore((s) => s.activeTool);
  const calibration = useAppStore((s) => s.calibration);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  return (
    <header className="z-40 flex h-12 shrink-0 animate-panel-top items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4">
      <h1 className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text font-mono text-sm font-bold tracking-widest text-transparent">
        S-CUBE
      </h1>
      <span className="hidden text-xs text-zinc-600 lg:inline">단면(㎡) × 연장(m) = 체적(㎥)</span>

      <div className="mx-2 h-5 w-px bg-zinc-800" />

      <button
        type="button"
        onClick={pickDxfFile}
        className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition-all duration-150 hover:bg-zinc-700 active:scale-[0.97]"
      >
        도면 열기
      </button>
      {/* 활성 파일명 표시는 탭 스트립(DrawingTabs)이 담당 — 중복 제거 */}

      <div className="mx-2 h-5 w-px bg-zinc-800" />

      <nav className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
        {TOOLS.map((tool) => {
          const active = activeTool === tool.id;
          const blocked = model === null || (tool.id === 'dim-check' && calibration === null);
          return (
            <button
              key={tool.id}
              type="button"
              title={
                tool.id === 'dim-check' && calibration === null
                  ? '캘리브레이션 완료 후 사용 가능'
                  : tool.hint
              }
              onClick={() => setActiveTool(tool.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ease-out ${
                active
                  ? 'animate-tool-pop bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4),0_0_12px_rgba(16,185,129,0.15)]'
                  : blocked
                    ? 'cursor-not-allowed text-zinc-600'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 active:scale-[0.96]'
              }`}
            >
              {tool.label}
            </button>
          );
        })}
        {/* 측정 — Phase 2. 캘리브레이션 여부와 무관하게 아직 비활성 (P1-11 배지) */}
        <button
          type="button"
          disabled
          title={
            calibration === null
              ? '캘리브레이션 미완료 — 측정 도구 비활성'
              : '측정 도구는 Phase 2에서 제공'
          }
          className="cursor-not-allowed rounded-md px-3 py-1 text-xs font-medium text-zinc-700"
        >
          측정
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => zoomToExtents()}
          disabled={model === null}
          title="전체 도면 화면맞춤 (Home)"
          className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-800 active:scale-[0.97] disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:bg-transparent"
        >
          Zoom Extents
        </button>
      </div>
    </header>
  );
}
