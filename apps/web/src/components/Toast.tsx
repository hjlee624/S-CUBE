/**
 * 토스트 — 우하단, 4초 자동 소멸. DWG 변환 안내(FR-1.2)·파싱 결과 등에 사용.
 */
import { useEffect } from 'react';
import { useAppStore } from '../store/index.ts';

const TONE_STYLES = {
  info: 'border-zinc-700 text-zinc-200',
  success: 'border-emerald-600/50 text-emerald-200',
  warn: 'border-amber-600/50 text-amber-200',
  error: 'border-red-700/60 text-red-200',
} as const;

const TONE_DOTS = {
  info: 'bg-zinc-400',
  success: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
} as const;

export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const dismissToast = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toast === null) return undefined;
    const t = setTimeout(() => dismissToast(toast.id), 4200);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  if (toast === null) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-10 z-50">
      <button
        key={toast.id}
        type="button"
        onClick={() => dismissToast(toast.id)}
        className={`pointer-events-auto flex max-w-md animate-toast-in items-center gap-2.5 rounded-lg border bg-zinc-900/95 px-4 py-2.5 text-left text-xs shadow-2xl shadow-black/50 backdrop-blur transition-transform duration-150 hover:scale-[1.02] ${TONE_STYLES[toast.tone]}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOTS[toast.tone]}`} />
        {toast.message}
      </button>
    </div>
  );
}
