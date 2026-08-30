/**
 * 캔버스 스테이지 — 렌더러 마운트, 팬/줌/스냅/클릭 입력, 드래그앤드롭, 로딩 오버레이.
 * 렌더 루프는 CanvasRenderer(RAF)가 담당하고 React는 입력·오버레이 UI만 관리한다.
 */

import type { Vec2 } from '@s-cube/schema';
import { useEffect, useRef, useState } from 'react';
import { pickDimensionAt, zoomToExtents } from '../canvas/actions.ts';
import { overlay } from '../canvas/overlay-state.ts';
import { CanvasRenderer } from '../canvas/renderer.ts';
import { findSnap } from '../canvas/snap.ts';
import { panByScreenDelta, screenToWorld, zoomAtScreenPoint } from '../canvas/transform.ts';
import { openDrawingFile } from '../lib/open-file.ts';
import { useAppStore } from '../store/index.ts';
import { PARSE_STAGE_LABELS } from '../workers/messages.ts';
import { EmptyHero } from './EmptyHero.tsx';

/**
 * 캘리브레이션 확정 순간의 화면 가장자리 emerald 펄스 —
 * 렌더 루프(renderer.ts)를 건드리지 않는 DOM/CSS 오버레이 피드백.
 */
function CalibrationPulse() {
  const calibratedAt = useAppStore((s) => s.calibration?.calibratedAt ?? null);
  const [pulseKey, setPulseKey] = useState<string | null>(null);
  const prevRef = useRef<string | null>(calibratedAt);

  useEffect(() => {
    if (calibratedAt !== null && prevRef.current !== calibratedAt) {
      setPulseKey(calibratedAt);
    }
    prevRef.current = calibratedAt;
  }, [calibratedAt]);

  if (pulseKey === null) return null;
  return (
    <div
      key={pulseKey}
      onAnimationEnd={() => setPulseKey(null)}
      className="pointer-events-none absolute inset-0 z-20 animate-success-pulse rounded-sm shadow-[inset_0_0_0_2px_rgba(52,211,153,0.7),inset_0_0_60px_rgba(16,185,129,0.18)]"
    />
  );
}

const SNAP_RADIUS_PX = 10;

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const model = useAppStore((s) => s.model);
  const fitToken = useAppStore((s) => s.fitToken);
  const loading = useAppStore((s) => s.loading);
  const activeTool = useAppStore((s) => s.activeTool);

  // 렌더러 수명주기
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const renderer = new CanvasRenderer();
    renderer.attach(canvas);

    // React 합성 wheel은 passive — preventDefault를 위해 네이티브 등록
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useAppStore.getState();
      if (s.model === null) return;
      const rect = canvas.getBoundingClientRect();
      const anchor: Vec2 = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = 1.0015 ** -e.deltaY;
      s.setViewport(
        zoomAtScreenPoint(s.viewport, anchor, factor, {
          width: rect.width,
          height: rect.height,
        }),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const s = useAppStore.getState();
      if (e.key === 'Home') {
        e.preventDefault();
        zoomToExtents();
      } else if (e.key === 'Escape') {
        if (s.pendingCalibration !== null || s.calibPoints.length > 0) {
          s.cancelCalibration();
        } else if (s.activeTool !== 'pan') {
          s.setActiveTool('pan');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      renderer.detach();
    };
  }, []);

  // 신규 도면 로드 시에만 Zoom Extents (초기 화면맞춤).
  // 탭 전환은 fitToken을 건드리지 않고 저장된 viewport를 복원하므로 화면맞춤하지 않는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitToken 변화만 트리거 (신규 로드 신호)
  useEffect(() => {
    if (fitToken === 0 || model === null) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    zoomToExtents({ width: canvas.clientWidth, height: canvas.clientHeight });
  }, [fitToken]);

  const toCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useAppStore.getState();
    const pos = toCanvasPos(e);
    const isPanButton = e.button === 1 || (e.button === 0 && s.activeTool === 'pan');
    if (isPanButton) {
      dragRef.current = { pointerId: e.pointerId, lastX: pos.x, lastY: pos.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || s.model === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    const world = screenToWorld(pos, s.viewport, size);
    if (s.activeTool === 'calibrate') {
      const snapped = overlay.snap?.point ?? world;
      s.addCalibPoint(snapped);
    } else if (s.activeTool === 'dim-check') {
      pickDimensionAt(world);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useAppStore.getState();
    const pos = toCanvasPos(e);
    const drag = dragRef.current;
    if (drag !== null && drag.pointerId === e.pointerId) {
      s.setViewport(panByScreenDelta(s.viewport, pos.x - drag.lastX, pos.y - drag.lastY));
      drag.lastX = pos.x;
      drag.lastY = pos.y;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    const world = screenToWorld(pos, s.viewport, size);
    overlay.cursorWorld = world;
    overlay.snap =
      s.activeTool === 'calibrate' && s.model !== null
        ? findSnap(world, s.viewport, SNAP_RADIUS_PX)
        : null;
    s.setCursorWorld(world);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onPointerLeave = () => {
    overlay.cursorWorld = null;
    overlay.snap = null;
    useAppStore.getState().setCursorWorld(null);
  };

  const onDoubleClick = () => {
    if (useAppStore.getState().activeTool === 'pan') zoomToExtents();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDropTarget(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) openDrawingFile(file);
  };

  const cursorClass =
    activeTool === 'pan'
      ? dragRef.current !== null
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : 'cursor-crosshair';

  const progressPct =
    loading.progress >= 0 ? Math.round(Math.min(loading.progress, 1) * 100) : null;

  return (
    // 드래그앤드롭 전용 영역 — 키보드 대체 경로는 헤더의 '도면 열기' 버튼
    <div
      role="application"
      aria-label="도면 캔버스"
      className="relative min-w-0 flex-1 overflow-hidden bg-zinc-950"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDropTarget(false);
      }}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className={`block h-full w-full touch-none select-none ${cursorClass}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
      />

      {/* 드롭 타겟 하이라이트 */}
      {isDropTarget && (
        <div className="pointer-events-none absolute inset-2 z-20 animate-fade-in rounded-xl border-2 border-dashed border-emerald-400/70 bg-emerald-400/5 backdrop-blur-[1px]">
          <div className="flex h-full items-center justify-center">
            <p className="animate-modal-in rounded-lg bg-zinc-900/90 px-4 py-2 font-mono text-sm text-emerald-300 shadow-lg shadow-emerald-500/20">
              놓아서 도면 열기 (DXF·DWG)
            </p>
          </div>
        </div>
      )}

      {/* 빈 상태 — 엔트리 히어로 (로드 시 hero-exit로 퇴장) */}
      <EmptyHero />

      {/* 캘리브레이션 확정 피드백 펄스 */}
      <CalibrationPulse />

      {/* 파싱 진행 오버레이 (P1-4) */}
      {loading.active && (
        <div className="absolute inset-0 z-30 flex animate-fade-in items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="glow-card w-80 animate-modal-in rounded-xl bg-zinc-900/95 p-5">
            <p className="truncate font-mono text-xs text-zinc-400">{loading.fileName}</p>
            <div className="mt-3 flex items-center justify-between text-sm">
              {/* 단계 라벨 전환 — key 교체로 blur-in 스왑, grid 겹침으로 레이아웃 점프 방지 */}
              <span className="inline-grid overflow-hidden text-zinc-200">
                <span key={loading.stage ?? 'ready'} className="animate-label-swap [grid-area:1/1]">
                  {loading.stage === null
                    ? '준비 중'
                    : loading.stage === 'convert' && loading.convertBackend !== null
                      ? `${PARSE_STAGE_LABELS.convert} (${loading.convertBackend})`
                      : PARSE_STAGE_LABELS[loading.stage]}
                </span>
              </span>
              <span className="font-mono text-xs text-emerald-400 tabular-nums">
                {progressPct !== null ? `${progressPct}%` : '…'}
              </span>
            </div>
            <div className="thinking-bar mt-2 h-1.5 animate-thinking overflow-hidden rounded-full">
              {progressPct !== null ? (
                <div
                  className="h-full rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)] transition-[width] duration-200 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-emerald-400/80" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
