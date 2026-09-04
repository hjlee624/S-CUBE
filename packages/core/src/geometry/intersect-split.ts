/**
 * RW-26: 교차점 선분 분할 — 서로 교차하는 선분들을 교차점에서 쪼갠다.
 *
 * 왜 필요한가: 절토/성토 단면은 원지반선(빨강)과 계획선(보라)이 **교차만 하고 끝점을 공유하지
 * 않는다**. 끝점 스냅(buildSnapGraph)만으로는 이 둘이 이루는 폐합 영역을 닫을 수 없다. 교차점에서
 * 선분을 분할해 교차점을 두 선분이 공유하는 새 끝점으로 만들면, 스냅 그래프가 교차점을 노드로
 * 인식하고 교차선들로 둘러싸인 구간이 폐합된다 → 점 지정 경계탐색(boundaryAtPoint)이 성립한다.
 *
 * 성능: 호출측이 클릭 주변 창으로 제한한 소규모 세그먼트(수십~수백)에만 쓴다. O(n²) 쌍 교차.
 */
import type { NEntity, Vec2 } from '@s-cube/schema';

interface Seg {
  a: Vec2;
  b: Vec2;
  handle: string;
  layer: string;
}

/** 엔티티(line/polyline) → 개별 선분 목록 */
function toSegments(entities: readonly NEntity[]): Seg[] {
  const out: Seg[] = [];
  for (const e of entities) {
    if (e.kind === 'line') {
      out.push({ a: e.a, b: e.b, handle: e.handle, layer: e.layer });
    } else if (e.kind === 'polyline') {
      const vs = e.vertices;
      for (let i = 0; i < vs.length - 1; i++) {
        const p = vs[i];
        const q = vs[i + 1];
        if (p !== undefined && q !== undefined) out.push({ a: p.p, b: q.p, handle: e.handle, layer: e.layer });
      }
      if (e.closed && vs.length > 2) {
        const last = vs[vs.length - 1];
        const first = vs[0];
        if (last !== undefined && first !== undefined) {
          out.push({ a: last.p, b: first.p, handle: e.handle, layer: e.layer });
        }
      }
    }
  }
  return out;
}

/**
 * 두 선분의 내부 교차 매개변수 (t on seg1, u on seg2). 끝점 근방(eps)·평행은 제외 — 실제
 * 가로지르는 교차만 분할 대상으로 삼는다(끝점 공유는 스냅이 처리).
 */
function properCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { t: number; u: number } | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // 평행/퇴화
  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  const eps = 1e-7;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null; // 내부 교차만
  return { t, u };
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 교차하는 선분들을 교차점에서 분할한 line 엔티티 목록을 반환한다(원본 handle 보존 — 역추적).
 * 교차가 없으면 원본을 그대로 line 으로 반환한다.
 */
export function splitAtIntersections(entities: readonly NEntity[]): NEntity[] {
  const segs = toSegments(entities);
  const n = segs.length;
  // 세그먼트별 분할 매개변수(t) 목록
  const cuts: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const si = segs[i];
    if (si === undefined) continue;
    for (let j = i + 1; j < n; j++) {
      const sj = segs[j];
      if (sj === undefined) continue;
      // 같은 엔티티(handle)에서 온 인접 세그먼트는 끝점 공유가 정상이므로 교차분할 제외.
      if (si.handle === sj.handle) continue;
      const x = properCross(si.a, si.b, sj.a, sj.b);
      if (x === null) continue;
      (cuts[i] as number[]).push(x.t);
      (cuts[j] as number[]).push(x.u);
    }
  }

  const out: NEntity[] = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    if (s === undefined) continue;
    const ts = (cuts[i] as number[])
      .filter((t) => t > 1e-7 && t < 1 - 1e-7)
      .sort((p, q) => p - q);
    // 중복 근접 제거
    const uniq: number[] = [];
    for (const t of ts) {
      if (uniq.length === 0 || t - (uniq[uniq.length - 1] as number) > 1e-6) uniq.push(t);
    }
    const pts: Vec2[] = [s.a, ...uniq.map((t) => lerp(s.a, s.b, t)), s.b];
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k];
      const q = pts[k + 1];
      if (p === undefined || q === undefined) continue;
      out.push({ kind: 'line', handle: s.handle, layer: s.layer, a: p, b: q });
    }
  }
  return out;
}
