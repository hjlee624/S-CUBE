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
import { openDrawingFile, pickDxfFile } from '../lib/open-file.ts';
import { useAppStore } from '../store/index.ts';
import { PARSE_STAGE_LABELS } from '../workers/messages.ts';

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
  const loading = useAppStore((s) => s.loading);
  const loadError = useAppStore((s) => s.loadError);
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

  // 모델이 바뀌면 Zoom Extents (초기 화면맞춤)
  useEffect(() => {
    if (model === null) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    zoomToExtents({ width: canvas.clientWidth, height: canvas.clientHeight });
  }, [model]);

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
            <p className="rounded-lg bg-zinc-900/90 px-4 py-2 font-mono text-sm text-emerald-300 shadow-lg">
              놓아서 DXF 열기
            </p>
          </div>
        </div>
      )}

      {/* 빈 상태 */}
      {model === null && !loading.active && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="pointer-events-auto animate-fade-in-up rounded-2xl border border-zinc-800 bg-zinc-900/80 px-10 py-8 text-center shadow-2xl backdrop-blur">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-500">
              S-CUBE Viewer
            </p>
            <p className="mt-3 text-sm text-zinc-400">DXF 파일을 이곳에 끌어다 놓거나</p>
            <button
              type="button"
              onClick={pickDxfFile}
              className="mt-4 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400 hover:shadow-emerald-400/30 active:scale-[0.97]"
            >
              도면 열기
            </button>
            <p className="mt-3 text-[11px] text-zinc-600">DWG는 DXF로 변환 후 사용하세요</p>
            {loadError !== null && (
              <p className="mt-4 max-w-xs rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-400">
                파싱 실패: {loadError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 파싱 진행 오버레이 (P1-4) */}
      {loading.active && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <div className="w-80 animate-fade-in-up rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <p className="truncate font-mono text-xs text-zinc-400">{loading.fileName}</p>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-zinc-200">
                {loading.stage !== null ? PARSE_STAGE_LABELS[loading.stage] : '준비 중'}
              </span>
              <span className="font-mono text-xs text-emerald-400">
                {progressPct !== null ? `${progressPct}%` : '…'}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              {progressPct !== null ? (
                <div
                  className="h-full rounded-full bg-emerald-400 transition-[width] duration-200 ease-out"
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
