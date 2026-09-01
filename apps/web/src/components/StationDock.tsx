/**
 * 측점·체적 하단 도크 (Phase 3-C) — RightPanel 이 꽉 차 있어 측점/체적은 별도 하단 도크로 분리.
 *
 * 탭 전환: 측점 테이블 / 구간 체적 / 종단 프로파일. 프로젝트 단위 산출이므로 도면 전환과
 * 독립적으로 보존된다(측점 상태는 station-slice, drawingId 태깅 없음).
 * 접힘/펼침 토글. 디자인 모션 토큰(panel-bottom 진입) 준수.
 */
import type { StationDockTab } from '../store/index.ts';
import { useAppStore } from '../store/index.ts';
import { ProfileGraph } from './ProfileGraph.tsx';
import { SegmentTable } from './SegmentTable.tsx';
import { StationTable } from './StationTable.tsx';

const TABS: { id: StationDockTab; label: string }[] = [
  { id: 'table', label: '측점 테이블' },
  { id: 'segments', label: '구간 체적' },
  { id: 'profile', label: '종단 프로파일' },
];

export function StationDock() {
  const open = useAppStore((s) => s.stationDockOpen);
  const tab = useAppStore((s) => s.stationDockTab);
  const toggle = useAppStore((s) => s.toggleStationDock);
  const setTab = useAppStore((s) => s.setStationDockTab);
  const sectionCount = useAppStore((s) => s.sections.length);

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950">
      {/* 도크 헤더 — 탭 + 접힘 토글 */}
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
          측점 · 체적
          <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium tabular-nums text-zinc-400">
            {sectionCount}
          </span>
        </button>

        {open &&
          TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'animate-tool-pop bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            );
          })}
      </div>

      {/* 본문 — 열렸을 때만 렌더 */}
      {open && (
        <div className="h-64 animate-panel-bottom border-t border-zinc-900">
          {tab === 'table' && <StationTable />}
          {tab === 'segments' && <SegmentTable />}
          {tab === 'profile' && <ProfileGraph />}
        </div>
      )}
    </div>
  );
}
