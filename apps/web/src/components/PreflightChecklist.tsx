/**
 * 산출 전 필수도면 체크리스트 (반자동 원칙: 경고이지 차단 아님).
 *
 * 산출 종류(TakeoffKind 4종) 선택 → 현재 로드된 모든 탭의 role로 evaluateChecklist 실행.
 * 각 요구사항의 충족/미충족, 필수/권장 배지, reason, 필요 역할을 표시한다.
 * 전체 satisfied면 "산출 준비 완료", 아니면 "누락: OO도면" 안내(차단 없음).
 */
import { evaluateChecklist } from '@s-cube/core';
import {
  DRAWING_ROLE_LABELS,
  type DrawingRole,
  TAKEOFF_KIND_LABELS,
  TAKEOFF_KINDS,
  type TakeoffKind,
} from '@s-cube/schema';
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/index.ts';

/** anyOf 역할 목록 → "평면도 또는 횡단면도" 문구 */
function rolesLabel(roles: DrawingRole[]): string {
  return roles.map((r) => DRAWING_ROLE_LABELS[r]).join(' 또는 ');
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M8 2.5L14.5 13.5H1.5L8 2.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function PreflightChecklist() {
  const drawings = useAppStore((s) => s.drawings);
  const [kind, setKind] = useState<TakeoffKind>('earthwork-section');

  const presentRoles = useMemo(() => drawings.map((d) => d.role), [drawings]);
  const result = useMemo(() => evaluateChecklist(kind, presentRoles), [kind, presentRoles]);

  const missingLabel = useMemo(
    () =>
      Array.from(new Set(result.missingRequired.flatMap((req) => req.anyOf)))
        .map((r) => DRAWING_ROLE_LABELS[r])
        .join(' · '),
    [result],
  );

  return (
    <section className="animate-fade-in-up rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
      <p className="font-semibold text-zinc-300">산출 전 체크리스트</p>

      {/* 산출 종류 선택 — 세그먼트 */}
      <div className="mt-2 grid grid-cols-2 gap-1">
        {TAKEOFF_KINDS.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-all duration-150 ease-out active:scale-[0.97] ${
                active
                  ? 'animate-tool-pop bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]'
                  : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {TAKEOFF_KIND_LABELS[k]}
            </button>
          );
        })}
      </div>

      {drawings.length === 0 ? (
        <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-2.5 py-2 text-zinc-500">
          도면을 열면 필요한 도면이 모두 준비됐는지 확인해 드립니다.
        </p>
      ) : (
        <>
          {/* 요구사항 목록 */}
          <ul className="mt-3 space-y-1.5">
            {result.items.map((item) => {
              const ok = item.present;
              return (
                <li
                  key={item.anyOf.join('|')}
                  className={`animate-row-in rounded-md border p-2 transition-colors duration-200 ${
                    ok
                      ? 'border-emerald-800/50 bg-emerald-950/20'
                      : 'border-amber-800/50 bg-amber-950/15'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>
                      {ok ? <CheckIcon /> : <WarnIcon />}
                    </span>
                    <span className="flex-1 font-medium text-zinc-200">
                      {rolesLabel(item.anyOf)}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                        item.necessity === 'required'
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-zinc-500/15 text-zinc-400'
                      }`}
                    >
                      {item.necessity === 'required' ? '필수' : '권장'}
                    </span>
                  </div>
                  <p className="mt-1 pl-5 text-[10px] leading-relaxed text-zinc-500">
                    {item.reason}
                    {ok && item.presentRoles.length > 0 && (
                      <span className="text-emerald-400/80">
                        {' '}
                        — {rolesLabel(item.presentRoles)} 확인됨
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>

          {/* 종합 안내 (차단 아님) */}
          {result.satisfied ? (
            <p className="mt-2.5 flex items-center gap-1.5 rounded-md border border-emerald-800/50 bg-emerald-950/25 px-2.5 py-1.5 font-medium text-emerald-300">
              <CheckIcon />
              산출 준비 완료
            </p>
          ) : (
            <p className="mt-2.5 rounded-md border border-amber-800/50 bg-amber-950/20 px-2.5 py-1.5 text-amber-300">
              <span className="font-semibold">누락: {missingLabel} 도면</span>
              <span className="mt-0.5 block text-[10px] font-normal leading-relaxed text-amber-400/80">
                없어도 진행할 수 있지만 산출이 부정확할 수 있습니다 (안내이지 차단 아님).
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
