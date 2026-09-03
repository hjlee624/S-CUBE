/**
 * 교차점 스냅 순수 기하 테스트 (RW-3) — 선분 교차 계산·엔티티 세그먼트 분해·근방 수집.
 *
 * bulgeToArc 는 @s-cube/core 실함수를 그대로 사용한다(원호 근사 교점 1건). 나머지는
 * scene/캔버스 의존 없는 순수 함수라 여기서 수치 정확성을 못박는다.
 */
import type { NArc, NLine, NPolyline } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  collectIntersections,
  type Seg,
  segmentIntersection,
  segmentsOf,
  tessellateArc,
} from './intersection.ts';

const seg = (ax: number, ay: number, bx: number, by: number): Seg => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

describe('segmentIntersection', () => {
  it('교차: X자 두 선분은 중앙에서 만난다', () => {
    const p = segmentIntersection(seg(-1, -1, 1, 1), seg(-1, 1, 1, -1));
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(0, 12);
    expect(p?.y).toBeCloseTo(0, 12);
  });

  it('비교차: 선분 범위 밖에서 직선은 만나지만 선분은 안 만난다', () => {
    // y=0 위의 짧은 선분과, 그와 만나려면 x=5 가 필요한 세로 선분
    const p = segmentIntersection(seg(0, 0, 1, 0), seg(5, -1, 5, 1));
    expect(p).toBeNull();
  });

  it('평행: 겹치지 않는 평행 선분은 null', () => {
    const p = segmentIntersection(seg(0, 0, 10, 0), seg(0, 1, 10, 1));
    expect(p).toBeNull();
  });

  it('공선(평행) 세그먼트도 유일 교점이 없으므로 null', () => {
    const p = segmentIntersection(seg(0, 0, 10, 0), seg(5, 0, 15, 0));
    expect(p).toBeNull();
  });

  it('끝점 공유: T자 접점도 교점으로 반환(범위 포함)', () => {
    // (0,0)-(2,0) 의 끝점 (2,0) 에서 세로 선분이 시작 → 접점 (2,0)
    const p = segmentIntersection(seg(0, 0, 2, 0), seg(2, 0, 2, 2));
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(2, 12);
    expect(p?.y).toBeCloseTo(0, 12);
  });
});

describe('segmentsOf', () => {
  it('line 은 한 세그먼트', () => {
    const e: NLine = {
      kind: 'line',
      handle: 'L',
      layer: '0',
      a: { x: 0, y: 0 },
      b: { x: 3, y: 4 },
    };
    const out: Seg[] = [];
    segmentsOf(e, out);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 3, y: 4 } });
  });

  it('open polyline 직선 3정점 → 2 세그먼트, closed → 3 세그먼트', () => {
    const open: NPolyline = {
      kind: 'polyline',
      handle: 'P',
      layer: '0',
      closed: false,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 0 },
        { p: { x: 1, y: 0 }, bulge: 0 },
        { p: { x: 1, y: 1 }, bulge: 0 },
      ],
    };
    const a: Seg[] = [];
    segmentsOf(open, a);
    expect(a).toHaveLength(2);

    const closed: NPolyline = { ...open, closed: true };
    const b: Seg[] = [];
    segmentsOf(closed, b);
    expect(b).toHaveLength(3);
  });

  it('arc 는 여러 직선 세그먼트로 근사(정점이 반지름 위)', () => {
    const e: NArc = {
      kind: 'arc',
      handle: 'A',
      layer: '0',
      center: { x: 0, y: 0 },
      r: 10,
      a0: 0,
      a1: Math.PI / 2,
    };
    const out: Seg[] = [];
    segmentsOf(e, out);
    expect(out.length).toBeGreaterThan(1);
    // 근사 정점은 모두 반지름 10 근처에 놓인다
    for (const s of out) {
      expect(Math.hypot(s.a.x, s.a.y)).toBeCloseTo(10, 6);
    }
  });
});

describe('tessellateArc', () => {
  it('완전한 원(a0==a1)은 닫힌 폴리곤으로 근사되어 시작=끝', () => {
    const out: Seg[] = [];
    tessellateArc({ x: 0, y: 0 }, 5, 0, 0, true, out);
    expect(out.length).toBeGreaterThan(3);
    const first = out[0]?.a;
    const last = out[out.length - 1]?.b;
    expect(first?.x).toBeCloseTo(last?.x ?? Number.NaN, 6);
    expect(first?.y).toBeCloseTo(last?.y ?? Number.NaN, 6);
  });
});

describe('collectIntersections', () => {
  it('서로 다른 엔티티(그룹)의 X자 교점만 near 반경 안에서 수집', () => {
    const g1 = [seg(-5, 0, 5, 0)]; // 수평
    const g2 = [seg(0, -5, 0, 5)]; // 수직 → 원점 교차
    const pts = collectIntersections([g1, g2], { x: 0, y: 0 }, 1);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.x).toBeCloseTo(0, 12);
    expect(pts[0]?.y).toBeCloseTo(0, 12);
  });

  it('같은 그룹(한 엔티티) 내부 세그먼트는 교차시키지 않는다', () => {
    // 한 폴리라인의 인접·자기교차 세그먼트 두 개 → 정점 공유가 교점으로 잡히면 안 됨
    const g = [seg(0, 0, 2, 0), seg(2, 0, 2, 2)];
    const pts = collectIntersections([g], { x: 2, y: 0 }, 5);
    expect(pts).toHaveLength(0);
  });

  it('교점이 near 반경 밖이면 버린다', () => {
    const g1 = [seg(-5, 0, 5, 0)];
    const g2 = [seg(0, -5, 0, 5)]; // 원점 교차
    const pts = collectIntersections([g1, g2], { x: 10, y: 10 }, 1);
    expect(pts).toHaveLength(0);
  });

  it('bulge 세그먼트 근사 교점 — 반원 호와 수직선의 교점 1건', () => {
    // bulge=1 → 반원(θ=π, 중심 (1,0), r=1). (0,0)→(2,0) 를 잇는 반원의 정점은 x=1 에서
    // (1,±1) (core sampleBulgeArc 방향 규약을 그대로 따른다). 세로선 x=1 이 그 정점을 관통.
    const arcPoly: NPolyline = {
      kind: 'polyline',
      handle: 'ARC',
      layer: '0',
      closed: false,
      vertices: [
        { p: { x: 0, y: 0 }, bulge: 1 },
        { p: { x: 2, y: 0 }, bulge: 0 },
      ],
    };
    const g1: Seg[] = [];
    segmentsOf(arcPoly, g1);
    // 근사 반원의 실제 정점(위/아래 어느 쪽이든)을 세그먼트에서 찾아 near 로 삼는다.
    let apex = g1[0]?.a ?? { x: 1, y: 0 };
    for (const s of g1) {
      if (Math.abs(s.b.x - 1) < Math.abs(apex.x - 1)) apex = s.b;
    }
    // 세로선 x=1 은 반원을 (1, ±1) 부근에서 관통
    const g2 = [seg(1, -2, 1, 2)];
    const pts = collectIntersections([g1, g2], apex, 0.2);
    expect(pts.length).toBeGreaterThanOrEqual(1);
    // 근사라 정확히 (1,±1)은 아니지만 원(r=1, 중심 (1,0)) 위·x=1 근처여야 한다.
    const on = pts.find(
      (p) => Math.abs(p.x - 1) < 0.05 && Math.abs(Math.hypot(p.x - 1, p.y - 0) - 1) < 0.02,
    );
    expect(on).toBeDefined();
  });
});
