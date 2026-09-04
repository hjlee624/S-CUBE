/**
 * 캘리브레이션 미완료 경고 배너 (P1-11) — 도면이 열려 있는데 축척이 없으면 표시.
 *
 * RW-23: 이미 캘리브레이션한 도면이 있거나 직전 축척이 있으면, 2점 재측정 없이
 * "축척 재사용"으로 곧바로 적용할 수 있게 한다 — 같은 축척 도면 세트에서 도면이
 * 바뀔 때마다 캘리브레이션을 처음부터 다시 하지 않도록(사용자 요구).
 */
import type { Calibration } from '@s-cube/schema';
import { useMemo } from 'react';
import { useAppStore } from '../store/index.ts';

/** 재사용 후보 — scale 로 중복 제거한 캘리브레이션 + 출처 라벨 */
interface ReuseCandidate {
  cal: Calibration;
  /** 출처 표시 ('직전' 또는 도면 파일명) */
  source: string;
}

export function CalibrationBanner() {
  const model = useAppStore((s) => s.model);
  const calibration = useAppStore((s) => s.calibration);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const activeTool = useAppStore((s) => s.activeTool);
  const drawings = useAppStore((s) => s.drawings);
  const activeId = useAppStore((s) => s.activeId);
  const lastCalibration = useAppStore((s) => s.lastCalibration);
  const reuseCalibration = useAppStore((s) => s.reuseCalibration);

  // 재사용 후보 수집 — 직전 축척 + 다른 도면들의 축척, scale 기준 중복 제거.
  const candidates = useMemo<ReuseCandidate[]>(() => {
    const out: ReuseCandidate[] = [];
    const seen = new Set<number>();
    const push = (cal: Calibration | null, source: string) => {
      if (cal === null || seen.has(cal.scale)) return;
      seen.add(cal.scale);
      out.push({ cal, source });
    };
    push(lastCalibration, '직전');
    for (const d of drawings) {
      if (d.id === activeId) continue;
      push(d.calibration, d.fileName);
    }
    return out.slice(0, 4);
  }, [lastCalibration, drawings, activeId]);

  if (model === null || calibration !== null) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-[92vw] animate-banner-in flex-col gap-2 rounded-2xl border border-amber-500/30 bg-zinc-900/95 px-4 py-2.5 shadow-xl shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-3">
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
              2점으로 설정
            </button>
          )}
        </div>

        {/* RW-23: 축척 재사용 — 직전/다른 도면 축척을 2점 재측정 없이 적용 */}
        {candidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800 pt-2">
            <span className="text-[10px] text-zinc-500">축척 재사용:</span>
            {candidates.map(({ cal, source }) => (
              <button
                key={`${source}:${cal.scale}`}
                type="button"
                onClick={() => reuseCalibration(cal)}
                title={`${source} 축척(1 도면단위 = ${cal.scale.toPrecision(4)} m)을 이 도면에 적용`}
                className="flex items-center gap-1.5 rounded-full border border-emerald-700/50 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-all duration-150 hover:border-emerald-600/70 hover:bg-emerald-500/15 active:scale-[0.96]"
              >
                <span className="max-w-[9rem] truncate text-emerald-400/80">{source}</span>
                <span className="font-mono tabular-nums">{cal.scale.toPrecision(4)} m/단위</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
