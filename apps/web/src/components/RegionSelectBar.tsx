/**
 * RW-28: 영역 면적 선택 확정 바 — 사각형 범위로 탐지된 폐합 공간 중 선택된 것들의 면적 합을
 * 보여주고, 확정(대상 셀 기입) / 취소한다. regionFaces 가 있을 때만 캔버스 상단에 뜬다.
 */
import { confirmRegionSelection } from '../canvas/actions.ts';
import { useAppStore } from '../store/index.ts';

export function RegionSelectBar() {
  const regionFaces = useAppStore((s) => s.regionFaces);
  const calibration = useAppStore((s) => s.calibration);
  const clearRegionFaces = useAppStore((s) => s.clearRegionFaces);
  const activeStationId = useAppStore((s) => s.activeStationId);
  const activeItemKey = useAppStore((s) => s.activeItemKey);

  if (regionFaces.length === 0) return null;

  const selected = regionFaces.filter((f) => f.selected);
  const scale = calibration?.scale ?? 1;
  // 면적은 축척² — 도면단위² → ㎡
  const sum_m2 = selected.reduce((acc, f) => acc + f.areaRaw, 0) * scale * scale;
  const hasTarget = activeStationId !== null && activeItemKey !== null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-[94vw] animate-banner-in flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/30 bg-white/95 px-4 py-2 shadow-xl shadow-black/10 backdrop-blur">
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
          영역 면적
        </span>
        <span className="text-xs text-zinc-600">
          탐지 <span className="font-semibold text-zinc-800">{regionFaces.length}</span> · 선택{' '}
          <span className="font-semibold text-emerald-700">{selected.length}</span>
        </span>
        <span className="font-mono text-sm font-semibold text-zinc-800 tabular-nums">
          합계 {sum_m2.toFixed(2)} ㎡
        </span>
        <span className="hidden text-[11px] text-zinc-500 sm:inline">
          도면에서 공간 클릭 = 선택 토글 ·{' '}
          {hasTarget ? '대상 셀에 누적 기입' : '대상 셀 미지정(측정만 생성)'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => confirmRegionSelection(true)}
            disabled={selected.length === 0}
            className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-emerald-600 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            누적 기입 (Enter)
          </button>
          <button
            type="button"
            onClick={() => clearRegionFaces()}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors duration-150 hover:bg-zinc-100"
          >
            취소 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
