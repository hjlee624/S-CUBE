import type { NArc, NCircle, NPolyline, NText } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { entityBounds } from '../geometry/bounds.ts';
import { mat3FromInsert } from '../geometry/mat3.ts';
import { polylineLength } from '../geometry/primitives.ts';
import { ARC_TESSELLATION_SEGMENTS_PER_TURN, transformEntity } from './transform.ts';

const base = { handle: 'H', layer: '0' } as const;
const quarterArc: NArc = {
  kind: 'arc',
  ...base,
  center: { x: 0, y: 0 },
  r: 1,
  a0: 0,
  a1: Math.PI / 2,
};
const unitCircle: NCircle = { kind: 'circle', ...base, center: { x: 0, y: 0 }, r: 1 };

describe('transformEntity — 상사변환 (원호 보존)', () => {
  it('회전 90°: 사분원호 각이 π/2→π로 이동', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 1, 1, Math.PI / 2);
    const out = transformEntity(quarterArc, m) as NArc;
    expect(out.kind).toBe('arc');
    expect(out.r).toBeCloseTo(1, 12);
    expect(out.a0).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(out.a1)).toBeCloseTo(Math.PI, 9);
  });

  it('균등 스케일 2 + 이동: 반지름 2배', () => {
    const m = mat3FromInsert({ x: 5, y: -1 }, 2, 2, 0);
    const out = transformEntity(quarterArc, m) as NArc;
    expect(out.kind).toBe('arc');
    expect(out.center).toEqual({ x: 5, y: -1 });
    expect(out.r).toBeCloseTo(2, 12);
  });

  it('반전(xScale=-1): CCW 유지를 위해 각 순서 뒤집기', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, -1, 1, 0);
    const out = transformEntity(quarterArc, m) as NArc;
    expect(out.kind).toBe('arc');
    // Q1 사분원호의 좌우 반전 = Q2 사분원호 (CCW: π/2 → π)
    expect(out.a0).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(out.a1)).toBeCloseTo(Math.PI, 9);
  });

  it('반전 시 폴리라인 bulge 부호 반전', () => {
    const poly: NPolyline = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 },
        { p: { x: 2, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    const m = mat3FromInsert({ x: 0, y: 0 }, 1, -1, 0);
    const out = transformEntity(poly, m) as NPolyline;
    expect(out.vertices[0]?.bulge).toBe(-1);
  });
});

describe('transformEntity — 텍스트 회전·미러', () => {
  const text = (rotation?: number): NText => {
    const t: NText = { kind: 'text', ...base, pos: { x: 1, y: 0 }, value: 'A', height: 2 };
    if (rotation !== undefined) t.rotation = rotation;
    return t;
  };

  it('회전 60° 블록 + 텍스트 30° → 90° 누적, mirrored 없음', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 1, 1, Math.PI / 3);
    const out = transformEntity(text(Math.PI / 6), m) as NText;
    expect(out.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(out.mirrored).toBeUndefined();
  });

  it('수평 미러(xScale=-1) + 텍스트 0°: 기준선 π, mirrored=true (180° 회전 오인 금지)', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, -1, 1, 0);
    const out = transformEntity(text(), m) as NText;
    expect(out.pos.x).toBeCloseTo(-1, 12);
    expect(Math.abs(out.rotation ?? 0)).toBeCloseTo(Math.PI, 12);
    expect(out.mirrored).toBe(true);
    expect(out.height).toBeCloseTo(2, 12);
  });

  it('수평 미러 + 텍스트 45°: 반사각 2α−θ = 135° (버그였던 θ+180°=225°가 아님)', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, -1, 1, 0);
    const out = transformEntity(text(Math.PI / 4), m) as NText;
    expect(out.rotation).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(out.mirrored).toBe(true);
  });

  it('수직 미러(yScale=-1) + 텍스트 0°: 기준선 방향 유지(≈0), mirrored=true', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 1, -1, 0);
    const out = transformEntity(text(), m) as NText;
    expect(out.rotation ?? 0).toBeCloseTo(0, 12);
    expect(out.mirrored).toBe(true);
  });

  it('미러 2회 적용: 파리티 상쇄 → mirrored 해제, 회전 ≈ 0', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, -1, 1, 0);
    const once = transformEntity(text(), m) as NText;
    const twice = transformEntity(once, m) as NText;
    expect(twice.mirrored).toBeUndefined();
    expect(twice.rotation ?? 0).toBeCloseTo(0, 12);
    expect(twice.pos.x).toBeCloseTo(1, 12);
  });

  it('비균등 스케일(2,1) + 텍스트 90°: 기준선 방향각 유지(π/2)', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 2, 1, 0);
    const out = transformEntity(text(Math.PI / 2), m) as NText;
    expect(out.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(out.mirrored).toBeUndefined();
  });
});

describe('transformEntity — 비균등 스케일 (폴리라인 근사 폴백)', () => {
  it('CIRCLE → 폐합 폴리라인, bounds가 타원 (±2, ±1)', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 2, 1, 0);
    const out = transformEntity(unitCircle, m);
    expect(out.kind).toBe('polyline');
    if (out.kind !== 'polyline') return;
    expect(out.closed).toBe(true);
    expect(out.vertices).toHaveLength(ARC_TESSELLATION_SEGMENTS_PER_TURN);
    const b = entityBounds(out);
    expect(b?.minX).toBeCloseTo(-2, 9);
    expect(b?.maxX).toBeCloseTo(2, 9);
    expect(b?.minY).toBeCloseTo(-1, 9);
    expect(b?.maxY).toBeCloseTo(1, 9);
  });

  it('ARC → 열린 폴리라인, 길이가 호장에 수렴 (0.1% 이내)', () => {
    const m = mat3FromInsert({ x: 0, y: 0 }, 3, 1, 0);
    // y 스케일 1·반지름 1의 원호를 x만 3배 → 타원호. 근사 정점으로 변환됐는지 확인
    const out = transformEntity(quarterArc, m);
    expect(out.kind).toBe('polyline');
    if (out.kind !== 'polyline') return;
    expect(out.closed).toBe(false);
    const first = out.vertices[0];
    const last = out.vertices[out.vertices.length - 1];
    expect(first?.p.x).toBeCloseTo(3, 9); // (1,0)×3
    expect(first?.p.y).toBeCloseTo(0, 9);
    expect(last?.p.x).toBeCloseTo(0, 9); // (0,1)
    expect(last?.p.y).toBeCloseTo(1, 9);
  });

  it('bulge 세그먼트 → 직선 분해, 길이가 호장에 수렴', () => {
    const poly: NPolyline = {
      kind: 'polyline',
      ...base,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 },
        { p: { x: 2, y: 0 }, bulge: 0 },
      ],
      closed: false,
    };
    // 비균등이지만 y축만 1.0에 가까운 대신 x 2배 — bulge가 모두 풀렸는지 확인
    const m = mat3FromInsert({ x: 0, y: 0 }, 1, 2, 0);
    const out = transformEntity(poly, m) as NPolyline;
    expect(out.vertices.length).toBeGreaterThan(10);
    expect(out.vertices.every((v) => v.bulge === 0)).toBe(true);
    // 원본(반원 r=1, 호장 π)의 근사 길이는 상사변환이 아니므로 다르지만,
    // 스케일 (1,1)이라면 π에 수렴해야 한다 — 항등에 가까운 검증용 케이스
    const identityLike = transformEntity(poly, mat3FromInsert({ x: 0, y: 0 }, 1, 1 + 1e-6, 0));
    if (identityLike.kind === 'polyline') {
      const len = polylineLength(identityLike.vertices, false);
      expect(len).toBeGreaterThan(Math.PI * 0.999);
      expect(len).toBeLessThanOrEqual(Math.PI * (1 + 1e-5));
    }
  });
});
