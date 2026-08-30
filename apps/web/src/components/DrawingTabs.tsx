/**
 * 도면 탭 스트립 — 다중 도면 워크스페이스 (헤더와 캔버스 사이).
 *
 * 로드된 도면을 탭으로 나열: 파일명(truncate) · 역할 배지(색상 구분) · 활성 하이라이트 ·
 * 닫기(×). 클릭 → switchToDrawing. 배지 클릭 → 역할 드롭다운(5역할) → setDrawingRole.
 * 도면 0개면 스트립을 숨긴다(EmptyHero만 노출).
 */
import { DRAWING_ROLE_LABELS, DRAWING_ROLES, type DrawingRole } from '@s-cube/schema';
import { useEffect, useRef, useState } from 'react';
import { closeDrawing, switchToDrawing } from '../lib/switch-drawing.ts';
import { useAppStore } from '../store/index.ts';

/** 역할별 배지 색상 토큰 — 평면/종단/횡단/표준·상세/기타 구분 */
const ROLE_BADGE: Record<DrawingRole, string> = {
  plan: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
  profile: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  'cross-section': 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  'standard-detail': 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  other: 'bg-zinc-500/15 text-zinc-400 ring-zinc-400/20',
};

function RoleBadge({ id, role }: { id: string; role: DrawingRole }) {
  const setDrawingRole = useAppStore((s) => s.setDrawingRole);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="역할 변경"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`animate-eye-pop rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset transition-all duration-150 hover:brightness-125 ${ROLE_BADGE[role]}`}
      >
        {DRAWING_ROLE_LABELS[role]}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-28 animate-modal-in overflow-hidden rounded-md border border-zinc-700 bg-zinc-900/98 py-1 shadow-xl shadow-black/40 backdrop-blur-sm">
          {DRAWING_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDrawingRole(id, r);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] transition-colors duration-100 hover:bg-zinc-800 ${
                r === role ? 'text-emerald-300' : 'text-zinc-300'
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ${ROLE_BADGE[r]}`}
              />
              {DRAWING_ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DrawingTabs() {
  const drawings = useAppStore((s) => s.drawings);
  const activeId = useAppStore((s) => s.activeId);

  // 도면 0개 → 스트립 숨김 (EmptyHero만)
  if (drawings.length === 0) return null;

  return (
    <div className="z-30 flex h-9 shrink-0 animate-panel-top items-stretch gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950/95 px-2 [animation-delay:40ms]">
      {drawings.map((d) => {
        const active = d.id === activeId;
        return (
          <div
            key={d.id}
            className={`group flex animate-row-in items-center gap-1.5 self-center rounded-md border py-1 pl-2 pr-1 text-xs transition-all duration-200 ease-out ${
              active
                ? 'border-emerald-700/60 bg-emerald-500/10 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.25),0_0_12px_rgba(16,185,129,0.12)]'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-zinc-200'
            }`}
          >
            <button
              type="button"
              onClick={() => switchToDrawing(d.id)}
              title={`${d.fileName} — ${d.entityCount.toLocaleString('ko-KR')}개 엔티티`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <RoleBadge id={d.id} role={d.role} />
              <span className="max-w-40 truncate font-mono text-[11px]">{d.fileName}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeDrawing(d.id);
              }}
              title="탭 닫기"
              aria-label={`${d.fileName} 닫기`}
              className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 transition-all duration-150 hover:bg-zinc-700 hover:text-zinc-200 active:scale-90"
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
                <path
                  d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
