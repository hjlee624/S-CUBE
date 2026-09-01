/**
 * 스크린 스페이스 드로잉 파라미터 (순수 로직) — canvas 없이 테스트 가능.
 *
 * 근본 문제: 평면도는 측량좌표(x≈2e5, y≈3e5)에 그려진다. 캔버스(Skia)는 내부 float32라
 * 좌표가 2e5~3e5 규모면 원호·복잡 경로 테셀레이션 정밀도가 무너져 곡선(arc/circle/bulge)이
 * 사라진다. 해결: 각 점을 worldToScreen으로 작은 화면 px(0~수천)로 미리 변환해 캔버스 경로
 * 명령에 넘긴다. 이 모듈은 그 변환의 "각도·반지름·회전 부호" 순수 계산을 담당한다.
 *
 * y-flip 규칙: worldToScreen은 y를 뒤집으므로(screen y-down) 월드 CCW 각도 a 의 점은
 * 화면에서 각도 -a 위치에 온다. 따라서 월드에서 a0→a1(CCW, anticlockwise=false)로 그리던
 * 호는 스크린 캔버스에서 startAngle=-a0, endAngle=-a1, anticlockwise=true 로 그려야 같은
 * 호가 된다(방향·형태 보존, reflex 호 포함).
 */
import type { Vec2 } from '@s-cube/schema';
import { bulgeToArc } from '../lib/core-api.ts';
import type { CanvasSize, Viewport } from './transform.ts';
import { worldToScreen } from './transform.ts';

/** 스크린 스페이스 호 파라미터 — ctx.arc(cx, cy, r, startAngle, endAngle, anticlockwise) 로 바로 소비 */
export interface ScreenArc {
  /** 화면 px 중심 x */
  cx: number;
  /** 화면 px 중심 y */
  cy: number;
  /** 화면 px 반지름 */
  r: number;
  /** 시작각 (라디안, 캔버스 각도계) */
  startAngle: number;
  /** 끝각 (라디안, 캔버스 각도계) */
  endAngle: number;
  /** ctx.arc 의 anticlockwise 플래그 */
  anticlockwise: boolean;
}

/**
 * 월드 호(center, a0→a1, CCW) → 스크린 호 파라미터.
 *
 * 반지름은 r_px = r · pxPerUnit. y-flip 으로 각도는 부호가 뒤집히고(startAngle=-a0,
 * endAngle=-a1) 스윕 방향도 뒤집힌다(월드 CCW=anticlockwise:false → 스크린 anticlockwise:true).
 *
 * @param center 월드 중심
 * @param a0 월드 시작각 (rad, CCW)
 * @param a1 월드 끝각 (rad, CCW)
 * @param worldCcw 월드 스윕 방향 (arc/circle=CCW=true, bulge는 arc.ccw)
 */
export function worldArcToScreen(
  center: Vec2,
  r: number,
  a0: number,
  a1: number,
  vp: Viewport,
  size: CanvasSize,
  worldCcw: boolean,
): ScreenArc {
  const s = worldToScreen(center, vp, size);
  return {
    cx: s.x,
    cy: s.y,
    r: r * vp.pxPerUnit,
    startAngle: -a0,
    endAngle: -a1,
    // 월드 CCW(anticlockwise=false) → 스크린 anticlockwise=true. y-flip 이 방향을 반전한다.
    anticlockwise: worldCcw,
  };
}

/** bulge 세그먼트(정점 a→b) → 스크린 호 파라미터. 월드에서 center/r/각도 구한 뒤 스크린 변환. */
export function bulgeSegmentToScreen(
  a: Vec2,
  b: Vec2,
  bulge: number,
  vp: Viewport,
  size: CanvasSize,
): ScreenArc {
  const arc = bulgeToArc(a, b, bulge);
  return worldArcToScreen(arc.center, arc.r, arc.a0, arc.a1, vp, size, arc.ccw);
}

/**
 * 텍스트 스크린 파라미터.
 *
 * - 원점: worldToScreen(pos) (화면 px)
 * - fontPx: height · pxPerUnit (도면단위 높이 → 화면 px)
 * - rotation: 월드 회전각은 CCW(y-up). 스크린은 y-down 이라 같은 시각 회전을 얻으려면 부호 반전.
 *   스크린 좌표계는 이미 y-down 이므로 글리프가 바로 선다(월드 y-up 보정 scale(1,-1) 불필요).
 */
export interface ScreenText {
  originX: number;
  originY: number;
  fontPx: number;
  /** 캔버스 ctx.rotate 에 넘길 회전각 (rad) */
  rotation: number;
}

export function textToScreen(
  pos: Vec2,
  height: number,
  worldRotation: number,
  vp: Viewport,
  size: CanvasSize,
): ScreenText {
  const s = worldToScreen(pos, vp, size);
  return {
    originX: s.x,
    originY: s.y,
    fontPx: height * vp.pxPerUnit,
    // 월드 CCW → 화면 y-down 이므로 부호 반전
    rotation: -worldRotation,
  };
}
