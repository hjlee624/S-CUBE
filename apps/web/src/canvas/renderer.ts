/**
 * Canvas 2D 렌더러 (P1-6, P1-7) — RAF 루프 + dirty 플래그.
 *
 * - devicePixelRatio 대응: 백버퍼 = CSS px × dpr
 * - 엔티티 각 점을 worldToScreen으로 스크린 px 변환 후 그린다 (측량 대좌표에서
 *   곡선 테셀레이션 정밀도 확보). setTransform은 dpr만 반영 — y 반전은 worldToScreen이 담당.
 *   원호 y-flip 각도 규칙은 draw-space.ts 참조.
 * - R-tree 뷰포트 컬링 후보만 렌더
 * - Zustand는 getState()로만 읽는다 (ADR 0002) — React 리렌더 없음
 */
import type { Bounds, DrawingModel, NEntity, Vec2 } from '@s-cube/schema';
import { aciToRgb, entityBounds } from '../lib/core-api.ts';
import { useAppStore } from '../store/index.ts';
import { bulgeSegmentToScreen, textToScreen, worldArcToScreen } from './draw-space.ts';
import { overlay } from './overlay-state.ts';
import { scene } from './scene.ts';
import { isMultiline, layoutTextLines } from './text-layout.ts';
import type { CanvasSize, Viewport } from './transform.ts';
import { viewportWorldBounds, worldToScreen } from './transform.ts';

const BG_COLOR = '#0b0b0d';
const GRID_DOT_COLOR = 'rgba(161, 161, 170, 0.28)'; // zinc-400
const ACCENT = '#34d399'; // emerald-400
const ACCENT_DIM = 'rgba(52, 211, 153, 0.45)';
const SNAP_COLOR = '#fbbf24'; // amber-400
const DIM_HILITE = '#f472b6'; // pink-400
const MEASURE_HILITE = '#34d399'; // emerald-400 — 측정 선택 하이라이트
const GROUND_HILITE = '#fb923c'; // orange-400 — 단면적 취득 1단계 원지반선 선택 하이라이트

/** 레이어명 → 색상 캐시 (모델 단위) */
let layerColorCache: { model: DrawingModel; colors: Map<string, string> } | null = null;

function layerColor(model: DrawingModel, layerName: string): string {
  if (layerColorCache === null || layerColorCache.model !== model) {
    const colors = new Map<string, string>();
    for (const layer of model.layers) colors.set(layer.name, aciToRgb(layer.colorIndex));
    layerColorCache = { model, colors };
  }
  return layerColorCache.colors.get(layerName) ?? '#d4d4d8';
}

function entityColor(model: DrawingModel, e: NEntity): string {
  const ci = e.colorIndex;
  if (ci === undefined || ci === 0 || ci === 256) return layerColor(model, e.layer);
  return aciToRgb(ci);
}

/**
 * 치수 근사(파선+틱) 렌더를 생략해야 하는가 — 치수블록이 전개(hasPicture)되어
 * 실제 치수선·화살표·값 텍스트가 일반 line/polyline/text 엔티티로 이미 그려질 때 true.
 * 이중 그리기를 막는다. 블록 없는 치수(hasPicture 미설정)는 false → 정의점 근사 폴백.
 */
export function dimensionHasPicture(e: NEntity): boolean {
  return e.kind === 'dimension' && e.hasPicture === true;
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId = 0;
  private dirty = true;
  private unsubscribe: (() => void) | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dirty = true;
    // 스토어의 모든 변화에 dirty 마킹 — 그리기는 RAF에서만
    this.unsubscribe = useAppStore.subscribe(() => {
      this.dirty = true;
    });
    const loop = () => {
      this.frame();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.rafId);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.canvas = null;
    this.ctx = null;
  }

  invalidate(): void {
    this.dirty = true;
  }

  private frame(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const bufW = Math.round(cssW * dpr);
    const bufH = Math.round(cssH * dpr);
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
      this.dirty = true;
    }
    overlay.canvasWidth = cssW;
    overlay.canvasHeight = cssH;

    const state = useAppStore.getState();
    // 스냅 마커 펄스·러버밴드는 시간 기반 애니메이션 → 해당 상태에선 매 프레임 그린다
    const animated =
      overlay.snap !== null ||
      (state.activeTool === 'calibrate' && state.calibPoints.length > 0) ||
      // 영역 면적 도구: 드래그 사각형·탐지면 토글을 매 프레임 반영
      state.activeTool === 'region-area';
    if (!this.dirty && !animated) return;
    this.dirty = false;

    const size: CanvasSize = { width: cssW, height: cssH };
    const vp = state.viewport;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, cssW, cssH);

    this.drawDotGrid(ctx, vp, size);

    const model = state.model;
    if (model !== null) {
      this.drawEntities(ctx, model, state.layerVisibility, vp, size, dpr);
      // 선택된 측정의 원본 엔티티 하이라이트 (스크린 스페이스, 엔티티와 동일 좌표계 글로우)
      this.drawMeasureHighlights(ctx, model, vp, size, dpr);
      // 단면적 취득 1단계: 선택된 원지반선을 서로 다른 색(orange)으로 하이라이트
      this.drawSectionGroundHighlight(ctx, model, vp, size, dpr);
    }
    // RW-28: 영역 면적 도구 — 드래그 사각형 + 탐지된 폐합면(선택/비선택)
    this.drawRegionOverlay(ctx, state, vp, size);

    // 오버레이는 화면 좌표계에서
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawCalibrationOverlay(ctx, vp, size, performance.now());
    this.drawDimCheckOverlay(ctx, vp, size);
    this.drawSnapMarker(ctx, vp, size, performance.now());
  }

  /** 줌 반응 dot grid — step ∈ {1,2,5}×10^k, 화면 간격 30~150px 유지 */
  private drawDotGrid(ctx: CanvasRenderingContext2D, vp: Viewport, size: CanvasSize): void {
    const targetPx = 60;
    const rawStep = targetPx / vp.pxPerUnit;
    const base = 10 ** Math.floor(Math.log10(rawStep));
    let step = base * 10;
    for (const mult of [1, 2, 5, 10]) {
      if (base * mult * vp.pxPerUnit >= 30) {
        step = base * mult;
        break;
      }
    }
    const stepPx = step * vp.pxPerUnit;
    if (!Number.isFinite(stepPx) || stepPx < 8) return;

    const world = viewportWorldBounds(vp, size);
    const startX = Math.ceil(world.minX / step) * step;
    const startY = Math.ceil(world.minY / step) * step;
    const cols = Math.floor((world.maxX - startX) / step) + 1;
    const rows = Math.floor((world.maxY - startY) / step) + 1;
    if (cols * rows > 40000 || cols < 0 || rows < 0) return;

    const alpha = Math.min(1, Math.max(0.15, (stepPx - 30) / 150 + 0.25));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = GRID_DOT_COLOR;
    for (let ix = 0; ix < cols; ix++) {
      for (let iy = 0; iy < rows; iy++) {
        const s = worldToScreen({ x: startX + ix * step, y: startY + iy * step }, vp, size);
        ctx.fillRect(s.x - 0.5, s.y - 0.5, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  private drawEntities(
    ctx: CanvasRenderingContext2D,
    model: DrawingModel,
    layerVisibility: Record<string, boolean>,
    vp: Viewport,
    size: CanvasSize,
    dpr: number,
  ): void {
    // 스크린 스페이스 드로잉: 캔버스는 dpr만 반영(선명도), 각 점은 worldToScreen으로 변환해
    // 작은 화면 px를 경로 명령에 넘긴다 → 측량 대좌표에서도 곡선 테셀레이션 정밀도 유지.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1; // 1 CSS px
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const query = viewportWorldBounds(vp, size, 64);
    const visibleIdx: number[] =
      scene.index !== null && scene.model === model
        ? scene.index.search(query).map((it) => it.i)
        : model.entities.map((_, i) => i);
    for (const i of scene.model === model ? scene.unboundedIndices : []) visibleIdx.push(i);

    for (const i of visibleIdx) {
      const e = model.entities[i];
      if (e === undefined) continue;
      if (layerVisibility[e.layer] === false) continue;
      const color = entityColor(model, e);
      this.drawEntity(ctx, e, color, vp, size);
    }
  }

  /**
   * 측정 하이라이트 (P2-7·P2-11) — 선택된 측정들의 원본 엔티티를 emerald 글로우로 덧그린다.
   *
   * 성능경로 훼손 금지: R-tree 뷰포트 컬링 후보 안에서 handle 매칭만 추가로 그린다(컬링 유지).
   * 선택이 없으면 handle 집합이 비어 즉시 반환한다(오버헤드 0).
   */
  /** RW-28: 영역 면적 도구 — 드래그 사각형 + 탐지 폐합면(선택=emerald 채움, 비선택=회색 파선) */
  private drawRegionOverlay(
    ctx: CanvasRenderingContext2D,
    state: ReturnType<typeof useAppStore.getState>,
    vp: Viewport,
    size: CanvasSize,
  ): void {
    const rd = overlay.regionDragRect;
    if (rd !== null) {
      const a = worldToScreen(rd.start, vp, size);
      const b = worldToScreen(rd.end, vp, size);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      ctx.save();
      ctx.fillStyle = 'rgba(52,211,153,0.07)';
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
    }
    const faces = state.regionFaces;
    if (faces.length === 0) return;
    ctx.save();
    for (const f of faces) {
      if (f.vertices.length < 3) continue;
      ctx.beginPath();
      let first = true;
      for (const v of f.vertices) {
        const p = worldToScreen(v, vp, size);
        if (first) {
          ctx.moveTo(p.x, p.y);
          first = false;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      if (f.selected) {
        ctx.fillStyle = 'rgba(16,185,129,0.22)';
        ctx.fill();
        ctx.setLineDash([]);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(161,161,170,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  private drawMeasureHighlights(
    ctx: CanvasRenderingContext2D,
    model: DrawingModel,
    vp: Viewport,
    size: CanvasSize,
    dpr: number,
  ): void {
    const state = useAppStore.getState();
    // 활성 도면의 선택된 측정 → sourceHandles 합집합
    const selected = new Set(state.selectedMeasurementIds);
    if (selected.size === 0) return;
    const handles = new Set<string>();
    for (const m of state.measurements) {
      if (m.drawingId !== state.activeId || !selected.has(m.id)) continue;
      for (const h of m.sourceHandles) handles.add(h);
    }
    if (handles.size === 0) return;

    // 스크린 스페이스: 캔버스는 dpr만 반영, 각 점은 worldToScreen으로 변환한다(대좌표 곡선 정밀도).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5; // 2.5 CSS px
    ctx.strokeStyle = MEASURE_HILITE;
    ctx.shadowColor = MEASURE_HILITE;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.95;

    const query = viewportWorldBounds(vp, size, 64);
    const visibleIdx: number[] =
      scene.index !== null && scene.model === model
        ? scene.index.search(query).map((it) => it.i)
        : model.entities.map((_, i) => i);
    for (const i of scene.model === model ? scene.unboundedIndices : []) visibleIdx.push(i);

    for (const i of visibleIdx) {
      const e = model.entities[i];
      if (e === undefined || !handles.has(e.handle)) continue;
      // 면적 도형(폐합 폴리라인·hatch·circle)은 채움 글로우도 살짝
      if ((e.kind === 'polyline' && e.closed) || e.kind === 'hatch' || e.kind === 'circle') {
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = MEASURE_HILITE;
        ctx.beginPath();
        if (e.kind === 'polyline') this.tracePolyline(ctx, e.vertices, true, vp, size);
        else if (e.kind === 'circle') {
          const c = worldToScreen(e.center, vp, size);
          ctx.arc(c.x, c.y, e.r * vp.pxPerUnit, 0, Math.PI * 2);
        } else for (const loop of e.loops) this.tracePolyline(ctx, loop.vertices, true, vp, size);
        ctx.fill('evenodd');
        ctx.restore();
      }
      this.drawEntity(ctx, e, MEASURE_HILITE, vp, size);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  /**
   * 단면적 취득(P3-13) 1단계 하이라이트 — 선택된 원지반선을 측정 하이라이트(emerald)와
   * 구분되는 orange 글로우로 덧그린다. 계획선은 두 번째 클릭 시 확정되며, 그때 생성된
   * 측정의 sourceHandles(원지반+계획) 가 emerald 로 자동 하이라이트된다(drawMeasureHighlights).
   *
   * 성능경로 유지: pendingSectionGround 가 null이면 즉시 반환(오버헤드 0). R-tree 컬링 후보
   * 안에서 handle 매칭만 추가로 그린다.
   */
  private drawSectionGroundHighlight(
    ctx: CanvasRenderingContext2D,
    model: DrawingModel,
    vp: Viewport,
    size: CanvasSize,
    dpr: number,
  ): void {
    const state = useAppStore.getState();
    const pending = state.pendingSectionGround;
    if (pending === null) return;
    const handle = pending.handle;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = GROUND_HILITE;
    ctx.shadowColor = GROUND_HILITE;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.95;

    const query = viewportWorldBounds(vp, size, 64);
    const visibleIdx: number[] =
      scene.index !== null && scene.model === model
        ? scene.index.search(query).map((it) => it.i)
        : model.entities.map((_, i) => i);
    for (const i of scene.model === model ? scene.unboundedIndices : []) visibleIdx.push(i);

    for (const i of visibleIdx) {
      const e = model.entities[i];
      if (e === undefined || e.handle !== handle) continue;
      this.drawEntity(ctx, e, GROUND_HILITE, vp, size);
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    e: NEntity,
    color: string,
    vp: Viewport,
    size: CanvasSize,
  ): void {
    const ppu = vp.pxPerUnit;
    ctx.strokeStyle = color;
    switch (e.kind) {
      case 'line': {
        const a = worldToScreen(e.a, vp, size);
        const b = worldToScreen(e.b, vp, size);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'polyline':
        ctx.beginPath();
        this.tracePolyline(ctx, e.vertices, e.closed, vp, size);
        ctx.stroke();
        break;
      case 'arc': {
        // NArc는 CCW 정의. y-flip 규칙으로 스크린 각도·방향 변환.
        const s = worldArcToScreen(e.center, e.r, e.a0, e.a1, vp, size, true);
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.r, s.startAngle, s.endAngle, s.anticlockwise);
        ctx.stroke();
        break;
      }
      case 'circle': {
        const c = worldToScreen(e.center, vp, size);
        ctx.beginPath();
        ctx.arc(c.x, c.y, e.r * ppu, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'hatch': {
        ctx.beginPath();
        for (const loop of e.loops) this.tracePolyline(ctx, loop.vertices, true, vp, size);
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color;
        ctx.fill('evenodd');
        ctx.restore();
        ctx.stroke();
        break;
      }
      case 'text': {
        // 화면상 4px 미만 텍스트는 컬링
        if (e.height * ppu < 4) break;
        const t = textToScreen(e.pos, e.height, e.rotation ?? 0, vp, size);
        ctx.save();
        ctx.translate(t.originX, t.originY);
        if (t.rotation !== 0) ctx.rotate(t.rotation);
        // 스크린 좌표계는 이미 y-down이라 글리프가 바로 선다(월드 y-up 보정은 worldToScreen에
        // 흡수됨) → 일반 텍스트는 scale(1,-1) 불필요. 미러 블록 텍스트(e.mirrored)는 기준선
        // 기준 반사(Phase 1 근사) → 정상 대비 scale(1,-1)로 상하 반사한다.
        const mirrored = e.mirrored === true;
        if (mirrored) ctx.scale(1, -1);
        ctx.fillStyle = color;
        ctx.font = `${t.fontPx}px "JetBrains Mono", Consolas, monospace`;
        ctx.textBaseline = 'alphabetic';
        if (isMultiline(e.value)) {
          // MTEXT 디코딩으로 \n 포함 가능 — 좌상단 기준 하강 렌더. 스크린 y-down이라
          // baselineOffset(px = height·ppu)을 그대로 +y로 더하면 화면 아래로 내려간다.
          // 미러(scale(1,-1)) 공간에선 +y가 화면 위 → 부호 반전해 하강을 유지한다.
          const lines = layoutTextLines(e.value, e.height * ppu);
          const dir = mirrored ? -1 : 1;
          for (const line of lines) ctx.fillText(line.text, 0, dir * line.baselineOffset);
        } else {
          ctx.fillText(e.value, 0, 0);
        }
        ctx.restore();
        break;
      }
      case 'dimension': {
        // 치수블록이 전개된 경우(hasPicture): 실제 치수선·화살표·값 텍스트가 일반
        // line/polyline/text 엔티티로 들어와 각자 렌더되므로 근사 그림을 그리지 않는다
        // (이중 그리기 방지). 블록 없는 치수만 정의점 근사(파선+틱)로 폴백.
        if (dimensionHasPicture(e)) break;
        // 치수는 정의점 연결 파선 + 정의점 틱으로 근사 렌더 (스크린 좌표)
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        for (let i = 0; i < e.defPoints.length; i++) {
          const p = e.defPoints[i];
          if (p === undefined) continue;
          const s = worldToScreen(p, vp, size);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const tick = 3;
        for (const p of e.defPoints) {
          const s = worldToScreen(p, vp, size);
          ctx.beginPath();
          ctx.moveTo(s.x - tick, s.y - tick);
          ctx.lineTo(s.x + tick, s.y + tick);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
    }
  }

  /** bulge ≠ 0 세그먼트는 원호로 (P1-6). 각 정점은 스크린 px로 변환해 경로에 넘긴다. */
  private tracePolyline(
    ctx: CanvasRenderingContext2D,
    vertices: readonly { p: Vec2; bulge: number }[],
    closed: boolean,
    vp: Viewport,
    size: CanvasSize,
  ): void {
    const first = vertices[0];
    if (first === undefined) return;
    const firstS = worldToScreen(first.p, vp, size);
    ctx.moveTo(firstS.x, firstS.y);
    const segCount = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < segCount; i++) {
      const v = vertices[i];
      const next = vertices[(i + 1) % vertices.length];
      if (v === undefined || next === undefined) continue;
      if (v.bulge === 0) {
        const s = worldToScreen(next.p, vp, size);
        ctx.lineTo(s.x, s.y);
      } else {
        const s = bulgeSegmentToScreen(v.p, next.p, v.bulge, vp, size);
        ctx.arc(s.cx, s.cy, s.r, s.startAngle, s.endAngle, s.anticlockwise);
      }
    }
    if (closed) ctx.closePath();
  }

  /** 캘리브레이션 라인·진행 중 러버밴드 (P1-10) */
  private drawCalibrationOverlay(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    size: CanvasSize,
    now_ms: number,
  ): void {
    const state = useAppStore.getState();

    // 확정된 캘리브레이션 기준선
    const cal = state.calibration;
    if (cal !== null) {
      const s1 = worldToScreen(cal.p1, vp, size);
      const s2 = worldToScreen(cal.p2, vp, size);
      ctx.save();
      ctx.strokeStyle = ACCENT_DIM;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      for (const s of [s1, s2]) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
      }
      ctx.restore();
    }

    // 진행 중 — 첫 점 + 커서 러버밴드
    if (state.activeTool !== 'calibrate') return;
    const p1 = state.calibPoints[0];
    if (p1 === undefined) return;
    const s1 = worldToScreen(p1, vp, size);
    const cursor = overlay.snap?.point ?? overlay.cursorWorld;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    // 첫 점 펄스 링
    const pulse = 0.5 + 0.5 * Math.sin(now_ms / 220);
    ctx.globalAlpha = 0.35 + 0.3 * pulse;
    ctx.beginPath();
    ctx.arc(s1.x, s1.y, 6 + 3 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(s1.x, s1.y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (cursor !== null) {
      const s2 = worldToScreen(cursor, vp, size);
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -(now_ms / 40) % 12; // 마칭 앤츠
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // 도면단위 거리 라벨
      const d = Math.hypot(cursor.x - p1.x, cursor.y - p1.y);
      const label = `${d.toPrecision(6)} (도면단위)`;
      const mx = (s1.x + s2.x) / 2;
      const my = (s1.y + s2.y) / 2;
      ctx.font = '11px "JetBrains Mono", Consolas, monospace';
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
      ctx.fillRect(mx - w / 2 - 6, my - 22, w + 12, 18);
      ctx.strokeStyle = ACCENT_DIM;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - w / 2 - 6, my - 22, w + 12, 18);
      ctx.fillStyle = ACCENT;
      ctx.fillText(label, mx - w / 2, my - 9);
    }
    ctx.restore();
  }

  /** 치수 대조 선택 하이라이트 (P1-12) */
  private drawDimCheckOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, size: CanvasSize): void {
    const state = useAppStore.getState();
    const check = state.dimCheck;
    const model = state.model;
    if (check === null || model === null) return;
    const dim = model.entities.find((e) => e.kind === 'dimension' && e.handle === check.handle);
    if (dim === undefined) return;
    const b: Bounds | null = entityBounds(dim);
    if (b === null) return;
    const tl = worldToScreen({ x: b.minX, y: b.maxY }, vp, size);
    const br = worldToScreen({ x: b.maxX, y: b.minY }, vp, size);
    ctx.save();
    ctx.strokeStyle = DIM_HILITE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(tl.x - 4, tl.y - 4, br.x - tl.x + 8, br.y - tl.y + 8);
    ctx.restore();
  }

  /** 스냅 마커 — endpoint □ / intersection ✕ / midpoint △ / center ○ (CAD 관례) */
  private drawSnapMarker(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    size: CanvasSize,
    now_ms: number,
  ): void {
    const snap = overlay.snap;
    if (snap === null) return;
    const s = worldToScreen(snap.point, vp, size);
    const pulse = 0.5 + 0.5 * Math.sin(now_ms / 180);
    const r = 6;
    ctx.save();
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 1.75;
    ctx.shadowColor = SNAP_COLOR;
    ctx.shadowBlur = 4 + 4 * pulse;
    ctx.beginPath();
    if (snap.kind === 'endpoint') {
      ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
    } else if (snap.kind === 'intersection') {
      // 교차점 — X 표시 (CAD 관례)
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
    } else if (snap.kind === 'midpoint') {
      ctx.moveTo(s.x, s.y - r - 1);
      ctx.lineTo(s.x + r, s.y + r - 1);
      ctx.lineTo(s.x - r, s.y + r - 1);
      ctx.closePath();
    } else {
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
}
