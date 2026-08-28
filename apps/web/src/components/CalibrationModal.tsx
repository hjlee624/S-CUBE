/**
 * 캘리브레이션 실거리 입력 모달 (P1-10) —
 * 2점 확정 후 실제 거리(m)를 입력받아 Calibration 생성·검증·저장.
 */
import { useEffect, useRef, useState } from 'react';
import { buildTwoPointCalibration, computeScale_mPerUnit } from '../lib/calibration.ts';
import { formatScaleLabel } from '../lib/format.ts';
import { useAppStore } from '../store/index.ts';

export function CalibrationModal() {
  const pending = useAppStore((s) => s.pendingCalibration);
  const cancelCalibration = useAppStore((s) => s.cancelCalibration);
  const applyCalibration = useAppStore((s) => s.applyCalibration);
  const showToast = useAppStore((s) => s.showToast);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pending !== null) {
      setInput('');
      // 모달 등장 애니메이션 후 포커스
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [pending]);

  if (pending === null) return null;

  const parsed = Number.parseFloat(input);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const previewScale = valid ? computeScale_mPerUnit(parsed, pending.drawingDistance) : null;

  const submit = () => {
    if (!valid) return;
    try {
      const cal = buildTwoPointCalibration(pending.p1, pending.p2, parsed);
      applyCalibration(cal);
      showToast(`캘리브레이션 완료 — ${formatScaleLabel(cal.scale)}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '캘리브레이션 생성 실패', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="실제 거리 입력"
    >
      <div className="w-96 animate-modal-in rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <p className="text-sm font-semibold text-zinc-100">실제 거리 입력</p>
        <p className="mt-1 text-xs text-zinc-500">
          선택한 두 점 사이의 실제 거리를 미터(m)로 입력하세요.
        </p>

        <div className="mt-4 rounded-lg bg-zinc-950/70 p-3 font-mono text-[11px] text-zinc-500">
          <div className="flex justify-between">
            <span>도면상 거리</span>
            <span className="text-zinc-300">{pending.drawingDistance.toPrecision(8)} 도면단위</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>산출 축척</span>
            <span className={previewScale !== null ? 'text-emerald-300' : 'text-zinc-600'}>
              {previewScale !== null ? formatScaleLabel(previewScale) : '—'}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') cancelCalibration();
            }}
            placeholder="예: 10"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none transition-all duration-150 placeholder:text-zinc-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
          <span className="font-mono text-sm text-zinc-500">m</span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelCalibration}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 transition-all duration-150 hover:bg-zinc-800 hover:text-zinc-200 active:scale-[0.97]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none"
          >
            축척 설정
          </button>
        </div>
      </div>
    </div>
  );
}
