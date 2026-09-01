/**
 * 앱 셸 — 3분할 레이아웃 (P0-5) + Phase 1 뷰어.
 * 좌: 레이어 패널 / 중앙: 캔버스 스테이지 / 우: 속성(캘리브레이션·치수 대조).
 */
import { CalibrationBanner } from './components/CalibrationBanner.tsx';
import { CalibrationModal } from './components/CalibrationModal.tsx';
import { CanvasStage } from './components/CanvasStage.tsx';
import { DrawingTabs } from './components/DrawingTabs.tsx';
import { DwgConvertModal } from './components/DwgConvertModal.tsx';
import { HeaderBar } from './components/HeaderBar.tsx';
import { LayerPanel } from './components/LayerPanel.tsx';
import { RightPanel } from './components/RightPanel.tsx';
import { StationDock } from './components/StationDock.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { TakeoffDock } from './components/TakeoffDock.tsx';
import { Toast } from './components/Toast.tsx';

export function App() {
  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <HeaderBar />
      <DrawingTabs />

      <div className="relative flex min-h-0 flex-1">
        <LayerPanel />
        <CanvasStage />
        <RightPanel />
        <CalibrationBanner />
      </div>

      {/* 측점·체적 하단 도크 (Phase 3-C) — 프로젝트 단위 산출, 도면 전환과 독립 */}
      <StationDock />

      {/* 규격 마스터·산출 항목·수량산출서 내보내기 도크 (Phase 4) */}
      <TakeoffDock />

      <StatusBar />
      <CalibrationModal />
      <DwgConvertModal />
      <Toast />
    </div>
  );
}
