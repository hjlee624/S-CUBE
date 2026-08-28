/**
 * 캘리브레이션 미완료 경고 배너 (P1-11) — 도면이 열려 있는데 축척이 없으면 표시.
 */
import { useAppStore } from '../store/index.ts';

export function CalibrationBanner() {
  const model = useAppStore((s) => s.model);
  const calibration = useAppStore((s) => s.calibration);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const activeTool = useAppStore((s) => s.activeTool);

  if (model === null || calibration !== null) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
      <div className="pointer-events-auto flex animate-banner-in items-center gap-3 rounded-full border border-amber-500/30 bg-zinc-900/95 py-1.5 pr-1.5 pl-4 shadow-xl shadow-black/40 backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
        </span>
        <p className="text-xs text-zinc-300">
          캘리브레이션 미완료 — <span className="text-amber-300">측정 도구가 비활성</span>
          입니다
        </p>
        {activeTool !== 'calibrate' && (
          <button
            type="button"
            onClick={() => setActiveTool('calibrate')}
            className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-300 transition-all duration-150 hover:bg-amber-500/25 active:scale-[0.96]"
          >
            지금 설정
          </button>
        )}
      </div>
    </div>
  );
}
