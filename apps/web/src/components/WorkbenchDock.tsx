/**
 * 수량산출 작업대 셸 (도킹/분리) — 기존 StationDock + TakeoffDock 를 대체한다.
 *
 * 기본은 하단 도크(접힘/펼침 유지). 도크 헤더의 '별도 창으로 분리' 버튼을 누르면
 * useDetachedWindow 로 Document PiP 창을 열고, QuantityWorkbench 를 그 창에 createPortal 로
 * 렌더한다. 분리 중에는 메인 도크 본문을 접고 슬림 바로 대체 → 캔버스가 세로를 되찾는다.
 *
 * 상태(측정·측점·체적·항목)는 Zustand 싱글턴이라 별도 창에서 편집해도 메인에 즉시 반영된다
 * (prop drilling 없음). 창 닫힘(pagehide)·되돌리기 시 자동 재도킹.
 */
import { createPortal } from 'react-dom';
import { useDetachedWindow } from '../hooks/useDetachedWindow.ts';
import { useAppStore } from '../store/index.ts';
import { QuantityWorkbench, WorkbenchTabs } from './QuantityWorkbench.tsx';

export function WorkbenchDock() {
  const open = useAppStore((s) => s.workbenchOpen);
  const toggle = useAppStore((s) => s.toggleWorkbench);
  const tab = useAppStore((s) => s.workbenchTab);
  const setTab = useAppStore((s) => s.setWorkbenchTab);
  const itemCount = useAppStore((s) => s.items.length);
  const sectionCount = useAppStore((s) => s.sections.length);
  const showToast = useAppStore((s) => s.showToast);

  const detached = useDetachedWindow({
    width: 860,
    height: 620,
    title: 'S-CUBE 수량산출',
    onBlocked: () =>
      showToast(
        '별도 창을 열 수 없습니다(팝업 차단). 브라우저 팝업 허용 후 다시 시도하세요.',
        'warn',
      ),
  });

  // 분리 중 — 메인 도크는 슬림 바로 축소(캔버스가 세로를 되찾음). 작업대는 PiP 창에 portal.
  if (detached.isDetached && detached.container != null) {
    return (
      <>
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-950">
          <div className="flex items-center gap-2 px-3 py-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              수량산출 작업대가 별도 창에서 열려 있습니다
            </span>
            <button
              type="button"
              onClick={detached.close}
              className="ml-auto rounded-md border border-zinc-800 px-2.5 py-1 text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
            >
              메인으로 되돌리기
            </button>
          </div>
        </div>
        {createPortal(
          <QuantityWorkbench variant="detached" onRedock={detached.close} />,
          detached.container,
        )}
      </>
    );
  }

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950">
      {/* 도크 헤더 — 접힘 토글 + (열렸을 때) 탭 + 분리 버튼 */}
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={toggle}
          className="mr-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-300 transition-colors duration-150 hover:bg-zinc-900"
          aria-expanded={open}
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          수량산출 작업대
          <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium tabular-nums text-zinc-400">
            측점 {sectionCount} · 항목 {itemCount}
          </span>
        </button>

        {open && <WorkbenchTabs tab={tab} onSelect={setTab} />}

        {/* 분리 버튼 — 우측 정렬, hover 마이크로 인터랙션 */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={detached.open}
            className="group flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-all duration-150 hover:border-emerald-400/60 hover:bg-emerald-500/15 hover:shadow-[0_0_0_3px_rgba(52,211,153,0.12)] active:scale-[0.97]"
            title={
              detached.supported
                ? '수량산출 작업대를 별도 창으로 분리(다른 모니터로 이동 가능)'
                : '수량산출 작업대를 별도 창으로 분리(팝업 창 폴백)'
            }
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px"
              aria-hidden="true"
            >
              <path
                d="M6 3H3v10h10v-3"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9 3h4v4M13 3L7.5 8.5"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            별도 창으로 분리
          </button>
        </div>
      </div>

      {/* 본문 — 열렸을 때만 렌더 (분리 중이 아님) */}
      {open && (
        <div className="h-72 animate-panel-bottom border-t border-zinc-900">
          <QuantityWorkbench variant="docked" />
        </div>
      )}
    </div>
  );
}
