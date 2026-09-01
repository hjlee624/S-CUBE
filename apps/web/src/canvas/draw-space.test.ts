/**
 * 스크린 스페이스 드로잉 파라미터 순수 로직 테스트 — 좌표 무관 정확성(이 수정의 핵심).
 *
 * 근본 문제 재현 방지: 측량 대좌표(x≈2e5, y≈3e5)에서도 캔버스 경로에 넘기는 좌표가 작은
 * 화면 px가 되어 곡선 테셀레이션이 무너지지 않음을 고정한다. arc y-flip 각도 매핑을 반원·
 * 1/4원·reflex 케이스로 손계산 대조, bulge·텍스트 파라미터도 검증.
 */
import { describe, expect, it } from 'vitest';
import { bulgeSegmentToScreen, textToScreen, worldArcToScreen } from './draw-space.ts';
import type { CanvasSize, Viewport } from './transform.ts';
import { worldToScreen } from './transform.ts';

const size: CanvasSize = { width: 100, height: 100 };
const vpOrigin: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 1 };

/** 캔버스 arc가 각도 θ에서 만드는 점 (cx+r·cosθ, cy+r·sinθ) */
function arcPoint(
  s: { cx: number; cy: number; r: number },
  theta: number,
): { x: number; y: number } {
  return { x: s.cx + s.r * Math.cos(theta), y: s.cy + s.r * Math.sin(theta) };
}

describe('worldArcToScreen — y-flip 각도·반지름 변환', () => {
  it('스크린 중심 = worldToScreen(center), 반지름 = r·pxPerUnit', () => {
    const vp: Viewport = { center: { x: 10, y: 20 }, pxPerUnit: 3 };
    const s = worldArcToScreen({ x: 15, y: 25 }, 4, 0, Math.PI, vp, size, true);
    const c = worldToScreen({ x: 15, y: 25 }, vp, size);
    expect(s.cx).toBeCloseTo(c.x);
    expect(s.cy).toBeCloseTo(c.y);
    expect(s.r).toBeCloseTo(12); // 4 · 3
  });

  it('startAngle=-a0, endAngle=-a1, anticlockwise=worldCcw', () => {
    const s = worldArcToScreen({ x: 0, y: 0 }, 1, 0.3, 1.2, vpOrigin, size, true);
    expect(s.startAngle).toBeCloseTo(-0.3);
    expect(s.endAngle).toBeCloseTo(-1.2);
    expect(s.anticlockwise).toBe(true);
  });

  it('1/4원(a0=0→a1=π/2, CCW): 끝점·중간점이 월드 호와 일치', () => {
    // 월드 center(0,0) r=1, vp origin/ppu=1, size 100 → worldToScreen(center)=(50,50)
    const s = worldArcToScreen({ x: 0, y: 0 }, 1, 0, Math.PI / 2, vpOrigin, size, true);
    // 시작점(월드 각0 → 월드(1,0) → 스크린(51,50))
    const start = arcPoint(s, s.startAngle);
    expect(start.x).toBeCloseTo(51);
    expect(start.y).toBeCloseTo(50);
    // 끝점(월드 각π/2 → 월드(0,1) → 스크린(50,49))
    const end = arcPoint(s, s.endAngle);
    expect(end.x).toBeCloseTo(50);
    expect(end.y).toBeCloseTo(49);
    // 중간점(월드 각π/4 → 월드(√½,√½) → 스크린(50.707,49.293)). start(0)→end(-π/2) 스윕
    const mid = arcPoint(s, (s.startAngle + s.endAngle) / 2);
    expect(mid.x).toBeCloseTo(50 + Math.SQRT1_2);
    expect(mid.y).toBeCloseTo(50 - Math.SQRT1_2);
  });

  it('반원(a0=0→a1=π, CCW): 끝점은 월드(-1,0)→스크린(49,50), 상단을 통과', () => {
    const s = worldArcToScreen({ x: 0, y: 0 }, 1, 0, Math.PI, vpOrigin, size, true);
    const start = arcPoint(s, s.startAngle); // 월드(1,0)→(51,50)
    const end = arcPoint(s, s.endAngle); // 월드(-1,0)→(49,50)
    expect(start.x).toBeCloseTo(51);
    expect(start.y).toBeCloseTo(50);
    expect(end.x).toBeCloseTo(49);
    expect(end.y).toBeCloseTo(50);
    // 월드 CCW 반원은 위쪽(y>0)을 지난다 → 스크린에선 위쪽(y<50). anticlockwise=true 로
    // startAngle(0)→endAngle(-π) 를 감소 방향 스윕하면 -π/2 를 지난다 → 점(50,49).
    const midTheta = -Math.PI / 2;
    const mid = arcPoint(s, midTheta);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(49); // 화면 위쪽
  });

  it('reflex(우각) 호(a0=0→a1=3π/2, CCW 270°): 방향 플래그·끝점 정확', () => {
    const s = worldArcToScreen({ x: 0, y: 0 }, 1, 0, (3 * Math.PI) / 2, vpOrigin, size, true);
    expect(s.anticlockwise).toBe(true);
    const start = arcPoint(s, s.startAngle); // 월드(1,0)→(51,50)
    const end = arcPoint(s, s.endAngle); // 월드 각3π/2 → 월드(0,-1)→스크린(50,51)
    expect(start.x).toBeCloseTo(51);
    expect(start.y).toBeCloseTo(50);
    expect(end.x).toBeCloseTo(50);
    expect(end.y).toBeCloseTo(51);
  });
});

describe('대좌표 → 작은 화면 px (근본 문제 방지)', () => {
  it('측량좌표 중심 근처 점이 뷰포트 안이면 화면 px 범위(0~size)로 나온다', () => {
    // 실제 평면도 중심 규모
    const vp: Viewport = { center: { x: 217769, y: 331215 }, pxPerUnit: 0.5 };
    const surveySize: CanvasSize = { width: 1200, height: 800 };
    const s = worldArcToScreen({ x: 217770, y: 331216 }, 2.5, 0, Math.PI / 2, vp, surveySize, true);
    // 중심 근처 → 화면 중앙 부근, 유한하고 작은 px
    expect(Number.isFinite(s.cx)).toBe(true);
    expect(Number.isFinite(s.cy)).toBe(true);
    expect(s.cx).toBeGreaterThanOrEqual(0);
    expect(s.cx).toBeLessThanOrEqual(surveySize.width);
    expect(s.cy).toBeGreaterThanOrEqual(0);
    expect(s.cy).toBeLessThanOrEqual(surveySize.height);
    // 반지름은 작은 px (2.5 · 0.5 = 1.25) — 대좌표 규모가 아님
    expect(s.r).toBeCloseTo(1.25);
    // 각도는 대좌표와 무관하게 y-flip 규칙 그대로
    expect(s.startAngle).toBeCloseTo(0);
    expect(s.endAngle).toBeCloseTo(-Math.PI / 2);
  });
});

describe('bulgeSegmentToScreen', () => {
  it('반원 bulge(=1): 스크린 중심은 현 중점, 반지름 = r·ppu, 유한', () => {
    // 현 (-1,0)→(1,0), bulge=1 → tan(θ/4)=1 → θ=π (반원). 중심(0,0), r=1.
    const s = bulgeSegmentToScreen({ x: -1, y: 0 }, { x: 1, y: 0 }, 1, vpOrigin, size);
    const c = worldToScreen({ x: 0, y: 0 }, vpOrigin, size);
    expect(s.cx).toBeCloseTo(c.x);
    expect(s.cy).toBeCloseTo(c.y);
    expect(s.r).toBeCloseTo(1); // r=1 · ppu=1
    expect(Number.isFinite(s.startAngle)).toBe(true);
    expect(Number.isFinite(s.endAngle)).toBe(true);
  });

  it('bulge 반지름은 pxPerUnit로 스케일된다 (대좌표에서도 작은 px)', () => {
    const vp: Viewport = { center: { x: 217769, y: 331215 }, pxPerUnit: 4 };
    const s = bulgeSegmentToScreen({ x: 217768, y: 331215 }, { x: 217770, y: 331215 }, 1, vp, size);
    // 현 길이 2, 반원 → r=1(월드) → r_px = 4
    expect(s.r).toBeCloseTo(4);
    expect(Number.isFinite(s.cx)).toBe(true);
    expect(Number.isFinite(s.cy)).toBe(true);
  });
});

describe('textToScreen', () => {
  it('fontPx = height·pxPerUnit, 원점 = worldToScreen(pos)', () => {
    const vp: Viewport = { center: { x: 100, y: 200 }, pxPerUnit: 2 };
    const t = textToScreen({ x: 110, y: 210 }, 2.5, 0, vp, size);
    const s = worldToScreen({ x: 110, y: 210 }, vp, size);
    expect(t.originX).toBeCloseTo(s.x);
    expect(t.originY).toBeCloseTo(s.y);
    expect(t.fontPx).toBeCloseTo(5); // 2.5 · 2
  });

  it('회전 부호 반전 (월드 CCW → 화면 y-down)', () => {
    const t = textToScreen({ x: 0, y: 0 }, 1, Math.PI / 6, vpOrigin, size);
    expect(t.rotation).toBeCloseTo(-Math.PI / 6);
  });

  it('대좌표에서도 fontPx는 작은 px, 원점은 화면 범위 안', () => {
    const vp: Viewport = { center: { x: 217769, y: 331215 }, pxPerUnit: 1 };
    const t = textToScreen({ x: 217769, y: 331215 }, 3, 0, vp, size);
    expect(t.fontPx).toBeCloseTo(3);
    expect(t.originX).toBeCloseTo(50);
    expect(t.originY).toBeCloseTo(50);
  });
});
