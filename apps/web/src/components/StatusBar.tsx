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
    <footer className="flex h-7 shrink-0 animate-panel-bottom items-center gap-4 border-t border-zinc-800 bg-zinc-950 px-4 font-mono text-[11px] text-zinc-500 [animation-delay:180ms]">
      {/* 커서 좌표 — 매 프레임 갱신되므로 애니메이션 없이 고정폭만 유지 (성능) */}
      <span className="inline-block w-56 tabular-nums">
        {cursorWorld !== null
          ? `X ${formatCoord(cursorWorld.x)}  Y ${formatCoord(cursorWorld.y)}`
          : 'X —  Y —'}
      </span>

      {/* 축척 — 값 변경 시 tick (key 교체) */}
      <span className="inline-grid overflow-hidden">
        <span
          key={calibration !== null ? calibration.scale : 'none'}
          className={`animate-tick transition-colors duration-300 [grid-area:1/1] ${
            calibration !== null ? 'text-emerald-400' : 'text-amber-500/90'
          }`}
        >
          {calibration !== null ? formatScaleLabel(calibration.scale) : '축척 미설정'}
        </span>
      </span>

      {activeTool === 'calibrate' && (
        <span className="inline-grid overflow-hidden">
          <span key={calibPoints.length} className="animate-tick text-emerald-300 [grid-area:1/1]">
            {calibPoints.length === 0 ? '첫 번째 점을 클릭하세요' : '두 번째 점을 클릭하세요'}
          </span>
        </span>
      )}
      {activeTool === 'dim-check' && (
        <span className="animate-fade-in text-pink-300">치수(DIMENSION)를 클릭하세요</span>
      )}

      {model !== null && (
        <span
          key={model.entities.length}
          className="ml-auto flex animate-tick items-center gap-4 text-zinc-600"
        >
          <span className="tabular-nums">엔티티 {formatCount(model.entities.length)}</span>
          <span className="tabular-nums">레이어 {formatCount(model.layers.length)}</span>
        </span>
      )}
    </footer>
  );
}
