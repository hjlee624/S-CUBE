/**
 * 상태바 — 커서 world 좌표(고정폭), 축척, 엔티티/레이어 수 (P1-11).
 */
import { formatCoord, formatCount, formatScaleLabel } from '../lib/format.ts';
import { useAppStore } from '../store/index.ts';

export function StatusBar() {
  const cursorWorld = useAppStore((s) => s.cursorWorld);
  const calibration = useAppStore((s) => s.calibration);
  const model = useAppStore((s) => s.model);
  const activeTool = useAppStore((s) => s.activeTool);
  const calibPoints = useAppStore((s) => s.calibPoints);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-950 px-4 font-mono text-[11px] text-zinc-500">
      <span className="inline-block w-56 tabular-nums">
        {cursorWorld !== null
          ? `X ${formatCoord(cursorWorld.x)}  Y ${formatCoord(cursorWorld.y)}`
          : 'X —  Y —'}
      </span>

      <span
        className={`transition-colors duration-300 ${
          calibration !== null ? 'text-emerald-400' : 'text-amber-500/90'
        }`}
      >
        {calibration !== null ? formatScaleLabel(calibration.scale) : '축척 미설정'}
      </span>

      {activeTool === 'calibrate' && (
        <span className="animate-fade-in text-emerald-300">
          {calibPoints.length === 0 ? '첫 번째 점을 클릭하세요' : '두 번째 점을 클릭하세요'}
        </span>
      )}
      {activeTool === 'dim-check' && (
        <span className="animate-fade-in text-pink-300">치수(DIMENSION)를 클릭하세요</span>
      )}

      {model !== null && (
        <span className="ml-auto flex items-center gap-4 text-zinc-600">
          <span>엔티티 {formatCount(model.entities.length)}</span>
          <span>레이어 {formatCount(model.layers.length)}</span>
        </span>
      )}
    </footer>
  );
}
