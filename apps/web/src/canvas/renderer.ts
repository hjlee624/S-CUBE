/**
 * Canvas 2D 렌더러 (P1-6, P1-7) — RAF 루프 + dirty 플래그.
 *
 * - devicePixelRatio 대응: 백버퍼 = CSS px × dpr
 * - 엔티티는 world 좌표 그대로 그리고 ctx.setTransform으로 투영 (y 반전 포함)
 * - R-tree 뷰포트 컬링 후보만 렌더
 * - Zustand는 getState()로만 읽는다 (ADR 0002) — React 리렌더 없음
 */
import type { Bounds, DrawingModel, NEntity, Vec2 } from '@s-cube/schema';
import { aciToRgb, bulgeToArc, entityBounds } from '../lib/core-api.ts';
import { useAppStore } from '../store/index.ts';
import { overlay } from './overlay-state.ts';
import { scene } from './scene.ts';
import type { CanvasSize, Viewport } from './transform.ts';
import { viewportWorldBounds, worldToScreen } from './transform.ts';

const BG_COLOR = '#0b0b0d';
const GRID_DOT_COLOR = 'rgba(161, 161, 170, 0.28)'; // zinc-400
const ACCENT = '#34d399'; // emerald-400
const ACCENT_DIM = 'rgba(52, 211, 153, 0.45)';
const SNAP_COLOR = '#fbbf24'; // amber-400
const DIM_HILITE = '#f472b6'; // pink-400

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
      overlay.snap !== null || (state.activeTool === 'calibrate' && state.calibPoints.length > 0);
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
    }

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
    const ppu = vp.pxPerUnit;
    // world → device 변환 (y 반전)
    ctx.setTransform(
      dpr * ppu,
      0,
      0,
      -dpr * ppu,
      dpr * (size.width / 2 - vp.center.x * ppu),
      dpr * (size.height / 2 + vp.center.y * ppu),
    );
    ctx.lineWidth = 1 / ppu; // 1 CSS px
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
      this.drawEntity(ctx, e, color, ppu);
    }
  }

  private drawEntity(ctx: CanvasRenderingContext2D, e: NEntity, color: string, ppu: number): void {
    ctx.strokeStyle = color;
    switch (e.kind) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
        break;
      case 'polyline':
        ctx.beginPath();
        this.tracePolyline(ctx, e.vertices, e.closed);
        ctx.stroke();
        break;
      case 'arc':
        ctx.beginPath();
        // NArc는 CCW 정의 → 파라미터 공간(월드)의 각도 증가 방향 = anticlockwise=false
        ctx.arc(e.center.x, e.center.y, e.r, e.a0, e.a1, false);
        ctx.stroke();
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(e.center.x, e.center.y, e.r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'hatch': {
        ctx.beginPath();
        for (const loop of e.loops) this.tracePolyline(ctx, loop.vertices, true);
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
        ctx.save();
        ctx.translate(e.pos.x, e.pos.y);
        if (e.rotation !== undefined && e.rotation !== 0) ctx.rotate(e.rotation);
        // 일반 텍스트: 월드 y-up 보정을 위해 scale(1,-1)로 글리프를 바로 세운다.
        // 미러 블록 텍스트(e.mirrored): 보정을 생략하면 기준선 기준 반사가 되어
        // 미러된 글리프로 표시된다 (Phase 1 근사 렌더)
        if (e.mirrored !== true) ctx.scale(1, -1);
        ctx.fillStyle = color;
        ctx.font = `${e.height}px "JetBrains Mono", Consolas, monospace`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(e.value, 0, 0);
        ctx.restore();
        break;
      }
      case 'dimension': {
        // 치수는 정의점 연결 파선 + 정의점 틱으로 근사 렌더
        ctx.save();
        ctx.setLineDash([6 / ppu, 4 / ppu]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        for (let i = 0; i < e.defPoints.length; i++) {
          const p = e.defPoints[i];
          if (p === undefined) continue;
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const tick = 3 / ppu;
        for (const p of e.defPoints) {
          ctx.beginPath();
          ctx.moveTo(p.x - tick, p.y - tick);
          ctx.lineTo(p.x + tick, p.y + tick);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
    }
  }

  /** bulge ≠ 0 세그먼트는 원호로 (P1-6) */
  private tracePolyline(
    ctx: CanvasRenderingContext2D,
    vertices: readonly { p: Vec2; bulge: number }[],
    closed: boolean,
  ): void {
    const first = vertices[0];
    if (first === undefined) return;
    ctx.moveTo(first.p.x, first.p.y);
    const segCount = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < segCount; i++) {
      const v = vertices[i];
      const next = vertices[(i + 1) % vertices.length];
      if (v === undefined || next === undefined) continue;
      if (v.bulge === 0) {
        ctx.lineTo(next.p.x, next.p.y);
      } else {
        const arc = bulgeToArc(v.p, next.p, v.bulge);
        // 월드 CCW = 파라미터 각도 증가 = anticlockwise=false
        ctx.arc(arc.center.x, arc.center.y, arc.r, arc.a0, arc.a1, !arc.ccw);
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

  /** 스냅 마커 — endpoint □ / midpoint △ / center ○ (CAD 관례) */
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
