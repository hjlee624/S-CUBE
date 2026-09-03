/**
 * 두 프로파일(원지반선 vs 계획선) 사이 면적 — 절토/성토 단면적 (도면 단위²).
 *
 * 토공 횡단면에서 원지반선(existing ground)과 계획선(design/plan) 사이 면적이 곧
 * 절토(cut)/성토(fill)량의 단면적이다.
 *   - 절토(cut)  = 원지반이 계획선보다 **위**인 영역(땅을 깎아냄).
 *                  area = ∫ max(0, ground_y − design_y) dx
 *   - 성토(fill) = 계획선이 원지반보다 **위**인 영역(흙을 쌓음).
 *                  area = ∫ max(0, design_y − ground_y) dx
 * 두 선이 교차하는 지점에서 절토·성토가 갈리므로 교차 x 를 적분 breakpoint 로 포함한다.
 *
 * 각주: 반환 필드명이 `_m2` 이지만 이 함수는 **도면 단위²** 를 반환한다. 미터 변환(×scale²)은
 * web 경계에서 1회만 수행한다(21-CONVENTIONS §4, lib/measure.ts applyScaleToRaw). core 는
 * 순수 기하(y=f(x) 함수 가정, 횡단면 표준)만 다루며 내부 계산은 반올림하지 않는다.
 */
import type { PVertex, Vec2 } from '@s-cube/schema';
import { bulgeToArc, distance } from './primitives.ts';

/** 두 프로파일 사이 면적 계산 결과 (도면 단위²). */
export interface ProfileAreaResult {
  /** 절토 단면적 — 원지반이 계획선보다 위인 영역 (도면 단위², 항상 ≥ 0). */
  cut_m2: number;
  /** 성토 단면적 — 계획선이 원지반보다 위인 영역 (도면 단위², 항상 ≥ 0). */
  fill_m2: number;
  /** 순 단면적 = cut_m2 − fill_m2 (양수면 절토 우세, 음수면 성토 우세). */
  net_m2: number;
  /** 실제 적분에 사용된 공통 x 구간 [min, max]. 겹치는 구간이 없으면 null. */
  overlapRange: [number, number] | null;
  /** 계산 중 감지한 경고(비단일값 x, 겹침 없음, 퇴화 입력 등). */
  warnings: string[];
}

/**
 * 원호 세그먼트 근사 분할 수 — bulge 곡률이 클수록 촘촘히.
 *
 * 면적 적분은 히트테스트(약 12°/조각)보다 정밀도에 민감하므로 약 1.5°/조각으로 촘촘히
 * 분할한다(최소 16, 최대 256). 그래도 원호를 직선으로 근사하므로 미세한 faceting 오차는
 * 남는다(반원 기준 상대오차 ≈ 0.01%). 정확한 활꼴 면적이 필요한 폐합 폴리곤은 area.ts
 * bulgeSegmentArea(해석해)를 쓰지만, 여기서는 y=f(x) 함수 가정을 지키려 샘플링한다.
 */
function arcSubdivisions(bulge: number): number {
  const sweep = 4 * Math.atan(Math.abs(bulge));
  const n = Math.ceil(sweep / (Math.PI / 120));
  return Math.min(256, Math.max(16, n));
}

/**
 * 프로파일(PVertex[])을 직선 근사 점열(Vec2[])로 평탄화 — bulge 원호는 여러 직선으로 분할.
 * 프로파일은 열린 폴리라인으로 취급한다(폐합하지 않음). 마지막 정점의 bulge 는 무시된다.
 */
function flattenProfile(vertices: PVertex[]): Vec2[] {
  const n = vertices.length;
  if (n === 0) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const v0 = vertices[i];
    const v1 = vertices[i + 1];
    if (v0 === undefined || v1 === undefined) continue;
    out.push(v0.p);
    if (v0.bulge !== 0 && distance(v0.p, v1.p) > 0) {
      const arc = bulgeToArc(v0.p, v1.p, v0.bulge);
      const steps = arcSubdivisions(v0.bulge);
      let sweep = arc.a1 - arc.a0;
      if (arc.ccw) {
        while (sweep <= 0) sweep += 2 * Math.PI;
      } else {
        while (sweep >= 0) sweep -= 2 * Math.PI;
      }
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const ang = arc.a0 + sweep * t;
        out.push({
          x: arc.center.x + arc.r * Math.cos(ang),
          y: arc.center.y + arc.r * Math.sin(ang),
        });
      }
    }
  }
  const last = vertices[n - 1];
  if (last !== undefined) out.push(last.p);
  return out;
}

/** 좌표가 모두 유한한지. */
function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * 점열을 x 오름차순으로 정렬하고 y=f(x) 선형보간용으로 정리한다.
 * 같은 x 에 여러 y(수직면·비단일값)면 warnings 에 기록하고 첫 y(정렬상 하나)를 대표값으로 남긴다.
 * 반환 점열은 x 가 순단조 증가(중복 x 제거)한다. 유효 점이 2개 미만이면 null.
 */
function prepareSampled(
  points: Vec2[],
  label: string,
  warnings: string[],
): { xs: number[]; ys: number[] } | null {
  const finite = points.filter(isFinitePoint);
  if (finite.length < points.length) {
    warnings.push(`${label}: 비유한 좌표를 무시했습니다.`);
  }
  if (finite.length < 2) return null;

  // x 오름차순 정렬(안정적: 원래 순서 tie-break 로 첫 y 를 대표값으로).
  const indexed = finite.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => (a.p.x === b.p.x ? a.i - b.i : a.p.x - b.p.x));

  const xs: number[] = [];
  const ys: number[] = [];
  let sawDuplicateX = false;
  for (const { p } of indexed) {
    const lastX = xs.length > 0 ? xs[xs.length - 1] : undefined;
    if (lastX !== undefined && p.x === lastX) {
      // 같은 x 에 여러 y → 첫 값 유지(대표값), 경고 1회.
      sawDuplicateX = true;
      continue;
    }
    xs.push(p.x);
    ys.push(p.y);
  }
  if (sawDuplicateX) {
    warnings.push(
      `${label}: 같은 x 에 여러 y(수직면·비단일값)가 있어 첫 값을 대표값으로 사용했습니다.`,
    );
  }
  if (xs.length < 2) return null;
  return { xs, ys };
}

/**
 * 정렬된 (xs, ys) 에서 x 위치의 y 를 선형보간한다.
 * x 가 구간 밖이면 가장 가까운 끝값으로 clamp(호출측이 공통 구간만 조회하므로 실제로는 clamp 미발생).
 */
function interpAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  const first = xs[0];
  const last = xs[n - 1];
  const firstY = ys[0];
  const lastY = ys[n - 1];
  if (first === undefined || last === undefined || firstY === undefined || lastY === undefined) {
    return 0;
  }
  if (x <= first) return firstY;
  if (x >= last) return lastY;
  // x 가 [xs[lo], xs[lo+1]] 에 들어가는 세그먼트를 이진 탐색으로 찾는다.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const xm = xs[mid];
    if (xm === undefined) break;
    if (xm <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo];
  const x1 = xs[lo + 1];
  const y0 = ys[lo];
  const y1 = ys[lo + 1];
  if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) return 0;
  const dx = x1 - x0;
  if (dx === 0) return y0;
  const t = (x - x0) / dx;
  return y0 + t * (y1 - y0);
}

/**
 * 공통 x 구간 안에서 diff(x) = ground_y(x) − design_y(x) 의 부호가 바뀌는 breakpoint(교차 x)를
 * 모두 찾는다. 두 프로파일 정점 x(공통 구간 내)들을 정렬·중복제거한 노드 사이에서
 * diff 부호 변화를 선형 보간으로 해석해 교차 x 를 추가한다.
 */
function collectBreakpoints(
  g: { xs: number[]; ys: number[] },
  d: { xs: number[]; ys: number[] },
  lo: number,
  hi: number,
): number[] {
  // 1) 두 프로파일 정점 x 중 [lo, hi] 안에 있는 것 + 경계 lo, hi 를 노드로 모은다.
  const nodes: number[] = [lo, hi];
  for (const x of g.xs) if (x > lo && x < hi) nodes.push(x);
  for (const x of d.xs) if (x > lo && x < hi) nodes.push(x);
  nodes.sort((a, b) => a - b);
  // 중복 제거
  const uniq: number[] = [];
  for (const x of nodes) {
    const prev = uniq.length > 0 ? uniq[uniq.length - 1] : undefined;
    if (prev === undefined || x !== prev) uniq.push(x);
  }

  const diff = (x: number): number => interpAt(g.xs, g.ys, x) - interpAt(d.xs, d.ys, x);

  const breaks: number[] = [...uniq];
  // 2) 인접 노드 사이에서 diff 부호가 바뀌면 선형 교차 x 를 추가.
  //    (노드 사이에는 두 프로파일 모두 선형이므로 diff 도 선형 → 교차는 최대 1개.)
  for (let i = 0; i < uniq.length - 1; i++) {
    const xa = uniq[i];
    const xb = uniq[i + 1];
    if (xa === undefined || xb === undefined) continue;
    const da = diff(xa);
    const db = diff(xb);
    // 양 끝에서 부호가 반대(하나는 +, 하나는 −)일 때만 내부 교차. 끝점이 0 인 경우는
    // 이미 노드로 포함되어 있으므로 별도 추가 불필요.
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db); // da + t(db−da)=0 → t = da/(da−db), 0<t<1
      const xc = xa + t * (xb - xa);
      if (Number.isFinite(xc) && xc > xa && xc < xb) breaks.push(xc);
    }
  }
  breaks.sort((a, b) => a - b);
  // 최종 중복 제거
  const out: number[] = [];
  for (const x of breaks) {
    const prev = out.length > 0 ? out[out.length - 1] : undefined;
    if (prev === undefined || x !== prev) out.push(x);
  }
  return out;
}

/**
 * 원지반선(ground)과 계획선(design) 두 프로파일 사이 절토·성토 단면적(도면 단위²).
 *
 * 방법(횡단면 표준, y=f(x) 가정):
 *   (a) bulge 세그먼트는 원호를 샘플링해 점열로 평탄화(bulgeToArc 재사용).
 *   (b) 각 프로파일을 x 오름차순 정렬, 같은 x 다중 y 는 대표값 + 경고.
 *   (c) 공통 x 구간 [max(minG,minD), min(maxG,maxD)] 에서 두 프로파일 정점 x + 교차 x 를 breakpoint 로.
 *   (d) 인접 breakpoint 를 사다리꼴로 (ground_y − design_y) 적분하되, 구간 부호별로
 *       cut(양수)·fill(음수 절대값) 누적. 교차점을 breakpoint 에 포함하므로 각 구간은 단일 부호.
 *
 * 견고성: 정점 부족(<2), 비유한 좌표, 공통 구간 없음/퇴화 → cut=fill=0 + 경고.
 */
export function areaBetweenProfiles(ground: PVertex[], design: PVertex[]): ProfileAreaResult {
  const warnings: string[] = [];

  if (ground.length < 2)
    warnings.push('원지반선(ground): 정점이 2개 미만이라 면적을 계산할 수 없습니다.');
  if (design.length < 2)
    warnings.push('계획선(design): 정점이 2개 미만이라 면적을 계산할 수 없습니다.');
  if (ground.length < 2 || design.length < 2) {
    return { cut_m2: 0, fill_m2: 0, net_m2: 0, overlapRange: null, warnings };
  }

  const g = prepareSampled(flattenProfile(ground), '원지반선(ground)', warnings);
  const d = prepareSampled(flattenProfile(design), '계획선(design)', warnings);
  if (g === null || d === null) {
    warnings.push('유효 점열이 부족해 면적을 계산할 수 없습니다.');
    return { cut_m2: 0, fill_m2: 0, net_m2: 0, overlapRange: null, warnings };
  }

  const gMin = g.xs[0];
  const gMax = g.xs[g.xs.length - 1];
  const dMin = d.xs[0];
  const dMax = d.xs[d.xs.length - 1];
  if (gMin === undefined || gMax === undefined || dMin === undefined || dMax === undefined) {
    return { cut_m2: 0, fill_m2: 0, net_m2: 0, overlapRange: null, warnings };
  }

  const lo = Math.max(gMin, dMin);
  const hi = Math.min(gMax, dMax);
  if (!(hi > lo)) {
    warnings.push('두 프로파일의 공통 x 구간이 없어(또는 퇴화) 면적이 0 입니다.');
    return { cut_m2: 0, fill_m2: 0, net_m2: 0, overlapRange: null, warnings };
  }

  const breaks = collectBreakpoints(g, d, lo, hi);

  let cut = 0;
  let fill = 0;
  for (let i = 0; i < breaks.length - 1; i++) {
    const x0 = breaks[i];
    const x1 = breaks[i + 1];
    if (x0 === undefined || x1 === undefined) continue;
    const w = x1 - x0;
    if (w <= 0) continue;
    const diff0 = interpAt(g.xs, g.ys, x0) - interpAt(d.xs, d.ys, x0);
    const diff1 = interpAt(g.xs, g.ys, x1) - interpAt(d.xs, d.ys, x1);
    // 이 구간은 breakpoint 에 교차 x 를 포함시켰으므로 부호가 일정하다.
    // 사다리꼴 면적 = (diff0 + diff1)/2 · w (부호 유지).
    const trap = ((diff0 + diff1) / 2) * w;
    if (trap > 0) cut += trap;
    else fill += -trap;
  }

  return {
    cut_m2: cut,
    fill_m2: fill,
    net_m2: cut - fill,
    overlapRange: [lo, hi],
    warnings,
  };
}
