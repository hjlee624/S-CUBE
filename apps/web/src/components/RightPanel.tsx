/**
 * 우측 속성 패널 — 캘리브레이션 상태 카드 + 치수 대조 결과 (P1-11, P1-12).
 */
import { insUnitsLabel } from '@s-cube/schema';
import { formatErrorPct, formatMeters, formatScaleLabel } from '../lib/format.ts';
import { useAppStore } from '../store/index.ts';
import { MeasurePanel } from './MeasurePanel.tsx';
import { PreflightChecklist } from './PreflightChecklist.tsx';

export function RightPanel() {
  const model = useAppStore((s) => s.model);
  const calibration = useAppStore((s) => s.calibration);
  const dimCheck = useAppStore((s) => s.dimCheck);
  const clearCalibration = useAppStore((s) => s.clearCalibration);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  return (
    <aside className="flex w-72 shrink-0 animate-panel-right flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-3 [animation-delay:140ms]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">속성</p>

      {model !== null && (
        <section className="animate-fade-in-up rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
          <p className="font-semibold text-zinc-300">도면 정보</p>
          <dl className="mt-2 space-y-1 font-mono text-[11px] text-zinc-500">
            <div className="flex justify-between">
              <dt>DXF 버전</dt>
              <dd className="text-zinc-300">{model.dxfVersion}</dd>
            </div>
            <div className="flex justify-between">
              <dt>$INSUNITS</dt>
              <dd className="text-zinc-300">{insUnitsLabel(model.insUnits)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* 캘리브레이션 카드 */}
      <section
        className={`rounded-lg border p-3 text-xs transition-all duration-300 ease-out ${
          calibration !== null
            ? 'border-emerald-800/60 bg-emerald-950/20 shadow-[inset_0_-9px_24px_rgba(16,185,129,0.06)]'
            : 'border-zinc-800 bg-zinc-900/60'
        }`}
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-zinc-300">캘리브레이션</p>
          {calibration !== null ? (
            <span
              key="done"
              className="animate-eye-pop rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
            >
              완료
            </span>
          ) : (
            <span
              key="unset"
              className="animate-eye-pop rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
            >
              미설정
            </span>
          )}
        </div>

        {calibration !== null ? (
          <>
            <dl className="mt-2 space-y-1 font-mono text-[11px] text-zinc-500">
              <div className="flex justify-between">
                <dt>도면상 거리</dt>
                <dd className="text-zinc-300">{calibration.drawingDistance.toPrecision(6)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>실제 거리</dt>
                <dd className="text-zinc-300">{formatMeters(calibration.realDistance_m)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>축척</dt>
                <dd className="text-emerald-300">{formatScaleLabel(calibration.scale)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>설정 시각</dt>
                <dd className="text-zinc-400">
                  {new Date(calibration.calibratedAt).toLocaleString('ko-KR')}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTool('calibrate')}
                className="flex-1 rounded-md bg-zinc-800 py-1.5 text-[11px] font-medium text-zinc-200 transition-all duration-150 hover:bg-zinc-700 active:scale-[0.97]"
              >
                다시 설정
              </button>
              <button
                type="button"
                onClick={clearCalibration}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500 transition-all duration-150 hover:border-red-900 hover:text-red-400 active:scale-[0.97]"
              >
                해제
              </button>
            </div>
          </>
        ) : (
          <div className="mt-2">
            <p className="text-zinc-500">
              도면 위 두 점을 클릭하고 실제 거리(m)를 입력하면 축척이 설정됩니다.
            </p>
            <button
              type="button"
              onClick={() => setActiveTool('calibrate')}
              disabled={model === null}
              className="mt-3 w-full rounded-md bg-emerald-500 py-1.5 text-[11px] font-semibold text-zinc-950 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              2점 캘리브레이션 시작
            </button>
          </div>
        )}
      </section>

      {/* 측정 결과 목록 (P2-10·P2-11) — 활성 도면 측정만 표시 */}
      <MeasurePanel />

      {/* 산출 전 필수도면 체크리스트 (다중 도면 워크스페이스) */}
      <PreflightChecklist />

      {/* 치수 대조 결과 (P1-12) */}
      {dimCheck !== null && (
        <section className="animate-fade-in-up rounded-lg border border-pink-900/50 bg-pink-950/10 p-3 text-xs">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-zinc-300">치수 대조</p>
            {dimCheck.hasOverride && (
              <span
                className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
                title="치수 텍스트가 수동 입력(override)되어 실측과 다를 수 있습니다"
              >
                텍스트 override
              </span>
            )}
          </div>
          {/* 결과 행 스태거 슬라이드-인 — 실측이 흘러드는 인상 (Cartesia 패턴) */}
          <dl key={dimCheck.handle} className="mt-2 space-y-1 font-mono text-[11px] text-zinc-500">
            <div className="flex animate-row-in justify-between">
              <dt>handle</dt>
              <dd className="text-zinc-400">{dimCheck.handle}</dd>
            </div>
            <div className="flex animate-row-in justify-between [animation-delay:50ms]">
              <dt>실측 (좌표)</dt>
              <dd className="text-zinc-300">{dimCheck.measuredRaw.toPrecision(8)}</dd>
            </div>
            <div className="flex animate-row-in justify-between [animation-delay:100ms]">
              <dt>실측 × scale</dt>
              <dd className="text-zinc-300">{formatMeters(dimCheck.measured_m)}</dd>
            </div>
            <div className="flex animate-row-in justify-between [animation-delay:150ms]">
              <dt>치수 텍스트</dt>
              <dd className="text-zinc-300">
                {dimCheck.hasOverride ? (dimCheck.textOverride ?? '—') : '(실측값 표시)'}
              </dd>
            </div>
            <div className="flex animate-row-in justify-between [animation-delay:200ms]">
              <dt>텍스트 × scale</dt>
              <dd className="text-zinc-300">{formatMeters(dimCheck.expected_m)}</dd>
            </div>
            <div className="flex animate-row-in justify-between border-t border-zinc-800 pt-1 [animation-delay:260ms]">
              <dt>오차</dt>
              <dd
                className={
                  Math.abs(dimCheck.error_pct) < 0.1 ? 'text-emerald-300' : 'text-amber-400'
                }
              >
                {formatErrorPct(dimCheck.error_pct)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            오차 0.1% 이내면 캘리브레이션이 유효합니다. override 치수는 도면 작성자가 값을 직접
            입력한 것이므로 주의하세요.
          </p>
        </section>
      )}
    </aside>
  );
}
