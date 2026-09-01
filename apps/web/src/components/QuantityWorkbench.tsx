/**
 * 수량산출 작업대 (통합) — 측점 테이블 / 구간 체적 / 종단 프로파일 / 규격·항목 / 내보내기 를
 * 하나의 탭 컨테이너에 모은다. 기존 StationTable/SegmentTable/ProfileGraph/SpecMaster/
 * TakeoffEditor/ProjectActions 를 그대로 재사용한다(로직 복제 금지).
 *
 * 도킹 모드와 분리 모드(별도 창) 둘 다에서 동일 내용으로 렌더된다 — 컨테이너만 다르다.
 * 분리 모드에서는 상단 미니 헤더(제목 + 되돌리기)를 노출한다. 탭 상태는 ui-slice 의
 * workbenchTab 을 재활용해 두 모드가 같은 탭을 공유한다(Zustand 싱글턴 자동 동기).
 */
import type { WorkbenchTab } from '../store/index.ts';
import { useAppStore } from '../store/index.ts';
import { ProfileGraph } from './ProfileGraph.tsx';
import { ProjectActions } from './ProjectActions.tsx';
import { SegmentTable } from './SegmentTable.tsx';
import { SpecMaster } from './SpecMaster.tsx';
import { StationTable } from './StationTable.tsx';
import { TakeoffEditor } from './TakeoffEditor.tsx';

const TABS: { id: WorkbenchTab; label: string }[] = [
  { id: 'stations', label: '측점 테이블' },
  { id: 'segments', label: '구간 체적' },
  { id: 'profile', label: '종단 프로파일' },
  { id: 'specs', label: '규격 마스터' },
  { id: 'items', label: '산출 항목' },
  { id: 'export', label: '내보내기' },
];

interface WorkbenchTabsProps {
  tab: WorkbenchTab;
  onSelect: (t: WorkbenchTab) => void;
}

/** 탭 버튼 줄 — 도킹/분리 공용 */
function WorkbenchTabs({ tab, onSelect }: WorkbenchTabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
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
  );
}

/** 활성 탭 본문 */
function WorkbenchBody({ tab }: { tab: WorkbenchTab }) {
  switch (tab) {
    case 'stations':
      return <StationTable />;
    case 'segments':
      return <SegmentTable />;
    case 'profile':
      return <ProfileGraph />;
    case 'specs':
      return <SpecMaster />;
    case 'items':
      return <TakeoffEditor />;
    case 'export':
      return <ExportPane />;
    default:
      return null;
  }
}

/** 내보내기 탭 — .scube 열기/저장 + 수량산출서 xlsx (ProjectActions 재사용) */
function ExportPane() {
  return (
    <div className="flex h-full flex-col items-start gap-4 overflow-auto p-6">
      <div className="max-w-lg space-y-1">
        <h3 className="text-sm font-semibold text-zinc-200">프로젝트 저장 · 수량산출서 내보내기</h3>
        <p className="text-[11px] leading-relaxed text-zinc-400">
          현재 측점·체적·항목·규격을 .scube 프로젝트로 저장하거나, 감리용 수량산출서(xlsx)로
          내보냅니다. 내보내기 전 검증 경고가 있으면 확인 후 진행합니다.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ProjectActions />
      </div>
    </div>
  );
}

interface QuantityWorkbenchProps {
  /**
   * docked: 메인 하단 도크 내부(헤더 없이 본문만).
   * detached: 별도 창 — 미니 헤더(제목 + 되돌리기) + 탭 + 본문의 완결 셸.
   */
  variant: 'docked' | 'detached';
  /** 분리 모드에서 '메인으로 되돌리기' */
  onRedock?: () => void;
}

/**
 * 수량산출 작업대 — variant 로 도킹/분리 셸만 달라지고 탭·본문은 동일.
 * 도킹 모드에서는 상위(WorkbenchDock)가 헤더·접힘 토글을 그리므로 여기서는 탭+본문만 렌더한다.
 */
export function QuantityWorkbench({ variant, onRedock }: QuantityWorkbenchProps) {
  const tab = useAppStore((s) => s.workbenchTab);
  const setTab = useAppStore((s) => s.setWorkbenchTab);

  if (variant === 'detached') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-200">
        {/* 미니 헤더 — 제목 + 되돌리기 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
              <rect
                x="2"
                y="2"
                width="12"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
              />
              <path d="M2 6h12" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            S-CUBE 수량산출
          </span>
          <div className="ml-auto">
            <button
              type="button"
              onClick={onRedock}
              className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-all duration-150 hover:bg-zinc-800 active:scale-[0.97]"
              title="메인 창으로 되돌리기"
            >
              메인으로 되돌리기
            </button>
          </div>
        </div>
        <div className="shrink-0 border-b border-zinc-900 px-2 py-1.5">
          <WorkbenchTabs tab={tab} onSelect={setTab} />
        </div>
        <div className="min-h-0 flex-1 animate-fade-in overflow-hidden">
          <WorkbenchBody tab={tab} />
        </div>
      </div>
    );
  }

  // docked — 탭 + 본문만(헤더/접힘은 WorkbenchDock 담당).
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkbenchBody tab={tab} />
      </div>
    </div>
  );
}

export { WorkbenchTabs };
