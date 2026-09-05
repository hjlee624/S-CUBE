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
import { RegionSelectBar } from './components/RegionSelectBar.tsx';
import { RightPanel } from './components/RightPanel.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Toast } from './components/Toast.tsx';
import { WorkbenchDock } from './components/WorkbenchDock.tsx';

export function App() {
  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200" data-testid="app-root">
      <HeaderBar />
      <DrawingTabs />

      <div className="relative flex min-h-0 flex-1">
        <LayerPanel />
        <CanvasStage />
        <RightPanel />
        <CalibrationBanner />
        <RegionSelectBar />
      </div>

      {/*
        수량산출 작업대 — 측점·체적·프로파일·규격·항목·내보내기 통합 하단 도크.
        '별도 창으로 분리' 시 Document PiP 창으로 떼어내고 캔버스가 세로를 되찾는다.
      */}
      <WorkbenchDock />

      <StatusBar />
      <CalibrationModal />
      <DwgConvertModal />
      <Toast />
    </div>
  );
}
