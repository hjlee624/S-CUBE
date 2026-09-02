import { describe, expect, it } from 'vitest';
import {
  type Center,
  classifyCenterOutliers,
  computeOutlierCriteria,
  FLOOR_RANGE_FRACTION,
  fullRangeSpan,
  isRelativeOutlier,
  isSpanOutlier,
  MIN_ENTITIES_FOR_RELATIVE,
  median,
  OUTLIER_ABSOLUTE_FLOOR,
  percentileSorted,
  robustExtent,
} from './outlier.ts';

describe('percentileSorted', () => {
  it('빈 배열은 NaN', () => {
    expect(percentileSorted([], 50)).toBeNaN();
  });

  it('단일 원소는 그 값', () => {
    expect(percentileSorted([42], 0)).toBe(42);
    expect(percentileSorted([42], 100)).toBe(42);
  });

  it('경계 백분위(0·100)와 중앙', () => {
    const s = [0, 10, 20, 30, 40];
    expect(percentileSorted(s, 0)).toBe(0);
    expect(percentileSorted(s, 100)).toBe(40);
    expect(percentileSorted(s, 50)).toBe(20);
  });

  it('범위를 벗어난 p는 클램프', () => {
    const s = [1, 2, 3];
    expect(percentileSorted(s, -10)).toBe(1);
    expect(percentileSorted(s, 200)).toBe(3);
  });
});

describe('median', () => {
  it('빈 배열은 NaN', () => {
    expect(median([])).toBeNaN();
  });

  it('정렬되지 않은 입력도 정렬 후 중앙값', () => {
    expect(median([30, 10, 20, 40, 0])).toBe(20);
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('robustExtent', () => {
  it('중심 없으면 0', () => {
    expect(robustExtent([])).toBe(0);
  });

  it('x·y MAD의 최대(극단값에 둔감)', () => {
    // 0..100에 촘촘히 분포 + 극단 이상치 1개 → MAD(와해점 50%)가 이상치를 배제
    const centers: Center[] = [];
    for (let i = 0; i <= 100; i++) centers.push({ x: i, y: i * 2 });
    centers.push({ x: 1e9, y: 1e9 }); // 극단값 — MAD에 거의 영향 없음
    const ext = robustExtent(centers);
    // x: median≈50, MAD≈25. y: median≈100, MAD≈50. 최대는 y쪽(~50). 1e9와 무관.
    expect(ext).toBeGreaterThan(20);
    expect(ext).toBeLessThan(80);
  });

  it('단일 극단 이상치가 산포를 부풀리지 못한다(소표본 와해점 방어)', () => {
    // 13개 중 12개는 폭 8 내 밀집, 1개는 5e10. 백분위(2.5~97.5)는 소표본에서 이상치를
    // 상위 트림 안에 못 넣어 오염됐지만 MAD는 이를 방어한다.
    const centers: Center[] = [];
    for (let i = 0; i < 12; i++) centers.push({ x: 100 + i * 0.7, y: 100 + i * 0.5 });
    centers.push({ x: 5e10, y: 100 });
    expect(robustExtent(centers)).toBeLessThan(100); // 밀집 규모, 5e10에 오염 안 됨
  });
});

/** 테스트용 중심 클러스터 생성 — (cx,cy) 주변 ±spread 격자 n×n */
function cluster(cx: number, cy: number, spread: number, n: number): Center[] {
  const out: Center[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push({
        x: cx + (i / Math.max(1, n - 1) - 0.5) * 2 * spread,
        y: cy + (j / Math.max(1, n - 1) - 0.5) * 2 * spread,
      });
    }
  }
  return out;
}

describe('computeOutlierCriteria — 데이터 부족 생략', () => {
  it(`중심 수 < ${MIN_ENTITIES_FOR_RELATIVE}면 null(상대 검출 생략)`, () => {
    const few = cluster(0, 0, 10, 2); // 4개
    expect(few.length).toBeLessThan(MIN_ENTITIES_FOR_RELATIVE);
    expect(computeOutlierCriteria(few)).toBeNull();
  });

  it(`중심 수 ≥ ${MIN_ENTITIES_FOR_RELATIVE}면 기준 산출`, () => {
    const enough = cluster(1000, 2000, 50, 4); // 16개
    const c = computeOutlierCriteria(enough);
    expect(c).not.toBeNull();
    // 격자 중앙값은 클러스터 중심 근처(짝수 개수라 정확히 중심은 아님)
    expect(c?.medX).toBeGreaterThan(950);
    expect(c?.medX).toBeLessThan(1050);
    expect(c?.medY).toBeGreaterThan(1950);
    expect(c?.medY).toBeLessThan(2050);
  });
});

describe('computeOutlierCriteria — cutoff = max(floor, K×extent)', () => {
  it('작은 도면은 ABSOLUTE_FLOOR가 지배', () => {
    // 폭 ~20인 도면 → K(100)×extent≈2000 < floor(1e4) → floor(ABSOLUTE_FLOOR)
    const c = computeOutlierCriteria(cluster(0, 0, 10, 5));
    expect(c?.cutoff).toBe(OUTLIER_ABSOLUTE_FLOOR);
  });

  it('큰 도면은 K×extent가 지배', () => {
    // 폭 ~2e5(MAD ~8e4)인 도면 → K(100)×extent ~8e6 ≫ floor 비례분 → K×extent 지배
    const c = computeOutlierCriteria(cluster(0, 0, 1e5, 6));
    expect(c?.cutoff).toBeGreaterThan(OUTLIER_ABSOLUTE_FLOOR);
    expect(c?.cutoff).toBeGreaterThan(5e6);
  });
});

describe('isRelativeOutlier — 밀집 클러스터 + 극단 이상치', () => {
  it('극단 이상치(중심 ~1e11)만 이상치로 판정, 클러스터는 유지', () => {
    const centers = cluster(2.177e5, 3.311e5, 1e3, 6); // 밀집(폭 2e3)
    const outlier: Center = { x: 4.988e11, y: 1.68e5 };
    const all = [...centers, outlier];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    // 클러스터 전부는 이상치 아님
    for (const c of centers) expect(isRelativeOutlier(c, criteria)).toBe(false);
    // 극단 좌표만 이상치
    expect(isRelativeOutlier(outlier, criteria)).toBe(true);
  });
});

describe('isRelativeOutlier — 정상 먼 콘텐츠 미폐기(회귀 방지)', () => {
  it('도면 3~5배 거리의 정상 콘텐츠(북방위표·범례 등)는 이상치 아님', () => {
    // 도면 규모 폭 ~2e5(extent ~8e4). cutoff = max(floor, K×extent) = 8e6(K×extent 지배).
    // 북방위표가 도면 밖 3~5배(6e5~1e6 거리)라도 cutoff(8e6) 안이라 유지된다.
    const centers = cluster(0, 0, 1e5, 6);
    const criteria = computeOutlierCriteria(centers);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    const farButLegit: Center[] = [
      { x: 6e5, y: 0 }, // 도면 폭 3배
      { x: 0, y: 1e6 }, // 도면 폭 5배
      { x: -8e5, y: 8e5 },
    ];
    for (const c of farButLegit) expect(isRelativeOutlier(c, criteria)).toBe(false);
  });

  it('작은 도면에서도 ABSOLUTE_FLOOR 안의 콘텐츠는 유지', () => {
    // 폭 ~20 도면 → cutoff = floor(ABSOLUTE_FLOOR). 이 도면 크기의 수백 배 거리라도
    // floor 이내(도면 부속 보호 창)면 유지. cutoff 확정 후 그 절반 지점을 검사한다.
    const centers = cluster(0, 0, 10, 5);
    const criteria = computeOutlierCriteria(centers);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    expect(criteria.cutoff).toBe(OUTLIER_ABSOLUTE_FLOOR);
    // floor 이내(절반 거리)의 부속은 유지 — 도면 폭의 수백 배지만 안전창 안.
    expect(isRelativeOutlier({ x: OUTLIER_ABSOLUTE_FLOOR / 2, y: 0 }, criteria)).toBe(false);
    // floor를 훨씬 초과(1e9)한 쓰레기 좌표는 이상치
    expect(isRelativeOutlier({ x: 1e9, y: 0 }, criteria)).toBe(true);
  });
});

describe('isRelativeOutlier — 다중 클러스터(합리적 거리) 둘 다 유지', () => {
  it('두 덩어리가 도면 규모의 몇 배 거리면 둘 다 유지', () => {
    // 클러스터 A(0,0)·B(3e5, 0) — 각 폭 ~2e5, 간격 3e5. 합쳐진 분포 백분위 폭이 커져
    // cutoff가 충분히 커지므로 어느 클러스터도 이상치 아님.
    const a = cluster(0, 0, 1e5, 6);
    const b = cluster(3e5, 0, 1e5, 6);
    const all = [...a, ...b];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    for (const c of all) expect(isRelativeOutlier(c, criteria)).toBe(false);
  });
});

describe('fullRangeSpan', () => {
  it('중심 없으면 0', () => {
    expect(fullRangeSpan([])).toBe(0);
  });

  it('p5~p95 폭(x·y 최대) — 극단값은 트림', () => {
    const centers: Center[] = [];
    for (let i = 0; i <= 100; i++) centers.push({ x: i, y: i * 2 });
    // x는 0..100(p5~p95 ≈ 90), y는 0..200(p5~p95 ≈ 180). 최대 ~180.
    const span = fullRangeSpan(centers);
    expect(span).toBeGreaterThan(150);
    expect(span).toBeLessThan(200);
  });

  it('소수 극단 이상치가 span을 지배하지 못한다(트림)', () => {
    const centers: Center[] = [];
    for (let i = 0; i < 100; i++) centers.push({ x: i, y: i });
    centers.push({ x: 1e11, y: 1e11 }); // 극단값 1개 — p95 트림으로 배제
    expect(fullRangeSpan(centers)).toBeLessThan(1e3);
  });
});

describe('computeOutlierCriteria — floor가 도면 전체 범위에 비례', () => {
  it('중간 규모 도면: floor = FLOOR_RANGE_FRACTION × 전체범위 > ABSOLUTE_FLOOR', () => {
    // 폭 ~4e5 도면(p5~p95 ~3.6e5). floor = 10 × 3.6e5 = 3.6e6 ≫ ABSOLUTE_FLOOR(1e4).
    const c = computeOutlierCriteria(cluster(0, 0, 2e5, 6));
    expect(c).not.toBeNull();
    if (c === null) return;
    const span = fullRangeSpan(cluster(0, 0, 2e5, 6));
    // K×extent도 크지만 최소한 floor 비례분 이상은 보장(정상 부속 보호 창이 도면에 비례)
    expect(c.cutoff).toBeGreaterThanOrEqual(FLOOR_RANGE_FRACTION * span);
  });

  it('아주 작은 도면: 전체범위가 미세하면 ABSOLUTE_FLOOR가 하한', () => {
    // 폭 ~20 도면 → 비례분(10×~18=180) < ABSOLUTE_FLOOR(1e4) → ABSOLUTE_FLOOR.
    const c = computeOutlierCriteria(cluster(0, 0, 10, 5));
    expect(c?.cutoff).toBe(OUTLIER_ABSOLUTE_FLOOR);
  });
});

describe('isSpanOutlier — span 팽창 검출', () => {
  it('cutoff보다 큰 span은 이상치, 이하이면 아님', () => {
    const criteria = computeOutlierCriteria(cluster(0, 0, 1e5, 6));
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    // 정상 엔티티 span(도면 규모 ~2e5)은 cutoff 이하
    expect(isSpanOutlier(2e5, criteria)).toBe(false);
    // 정점 하나가 ~1e11이라 span만 1e11로 부푼 손상은 이상치
    expect(isSpanOutlier(1e11, criteria)).toBe(true);
  });
});

/** 균등 격자 대신 표본 편차가 아주 작은(MAD ~extent) 밀집 클러스터 n×n. */
function tightCluster(cx: number, cy: number, halfSpan: number, n: number): Center[] {
  const out: Center[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push({
        x: cx + (i / Math.max(1, n - 1) - 0.5) * 2 * halfSpan,
        y: cy + (j / Math.max(1, n - 1) - 0.5) * 2 * halfSpan,
      });
    }
  }
  return out;
}

describe('classifyCenterOutliers — 응집 소수 클러스터 보호 vs 고립 폐기 (major #1)', () => {
  it('compact 본체 + cutoff 밖 응집 범례 클러스터(≥MIN, <5% 소수)는 폐기하지 않는다', () => {
    // 본체: MAD-extent ~1e4(폭 ~2e4), 200개 밀집. 범례가 p95 트림 밖이라 fullRange는 본체 폭
    // 수준(~6e4)이고 floor = 10×6e4 = 6e5가 지배 → cutoff ~6e5.
    // 범례: 본체에서 ~3e6 떨어진 곳에 9개 응집(내부 폭 ~2e4). 9/209 ≈ 4.3% < 5%라 p95
    // 트림 밖 → 전체범위 span이 커지지 않아 cutoff는 여전히 ~6e5. 따라서 범례는 cutoff를
    // 넘는 "후보"가 되지만, 서로 cutoff 이내로 뭉쳐 있고 8 ≥ MIN(8)이라 정상 부속으로
    // 보호되어야 한다(고정 1e6 창이 도면 밖 정상 부속을 통째로 버리던 false-positive 방지).
    const main: Center[] = [];
    for (let i = 0; i < 200; i++) {
      main.push({ x: 1e5 + (i % 14) * 1500, y: 1e5 + Math.floor(i / 14) * 1500 });
    }
    const legend = tightCluster(1e5 + 3e6, 1e5, 1e4, 3); // 9개(≥8), 내부 폭 ~2e4
    const all = [...main, ...legend];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    // 범례는 실제로 cutoff를 넘는 후보여야 이 테스트가 의미가 있다(응집 보호가 실제로 작동).
    expect(isRelativeOutlier(legend[0] as Center, criteria)).toBe(true);
    const drop = classifyCenterOutliers(all, criteria);
    // 본체는 전혀 폐기 안 됨
    for (let i = 0; i < main.length; i++) expect(drop[i]).toBe(false);
    // 응집 범례 클러스터도 전혀 폐기 안 됨(정상 제2 클러스터 보호)
    for (let i = main.length; i < all.length; i++) expect(drop[i]).toBe(false);
  });

  it('compact 본체 + 고립 쓰레기 1점(~1e11)은 폐기한다', () => {
    const main = tightCluster(1e5, 1e5, 1e4, 6); // 36개
    const lone: Center = { x: 1e11, y: 1e5 };
    const all = [...main, lone];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    const drop = classifyCenterOutliers(all, criteria);
    for (let i = 0; i < main.length; i++) expect(drop[i]).toBe(false);
    expect(drop[main.length]).toBe(true); // 고립 쓰레기만 폐기
  });

  it('소수(< MIN)만 뭉친 먼 무리는 폐기(응집이라도 최소치 미달)', () => {
    // 본체 200개 + 먼 곳(~5e10)에 4개만 응집. 4/204 ≈ 2% < 5%라 p95 트림 밖 → cutoff ~6e5.
    // 4개는 cutoff 밖 후보이고 서로 뭉쳐 있지만 4 < MIN(8)이라 정상 부속으로 인정 못 함 → 폐기.
    const main: Center[] = [];
    for (let i = 0; i < 200; i++) {
      main.push({ x: 1e5 + (i % 14) * 1500, y: 1e5 + Math.floor(i / 14) * 1500 });
    }
    const fewFar = tightCluster(1e5 + 5e10, 1e5, 1e3, 2); // 4개(< 8)
    const all = [...main, ...fewFar];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    expect(isRelativeOutlier(fewFar[0] as Center, criteria)).toBe(true); // 실제 후보
    const drop = classifyCenterOutliers(all, criteria);
    for (let i = 0; i < main.length; i++) expect(drop[i]).toBe(false);
    for (let i = main.length; i < all.length; i++) expect(drop[i]).toBe(true);
  });
});

/**
 * floor 교정(OUTLIER_ABSOLUTE_FLOOR 1e6 → 1e4) 회귀 고정.
 *
 * 실도면(여수로 굴착계획 평면도) 사례: 실제 콘텐츠는 폭 ~1276·높이 ~782 규모로 밀집한데,
 * 좌표 부호가 뒤집힌 쓰레기 폴리라인 6개가 중앙값에서 체비쇼프 3.3e5~6.7e5 떨어져 있다.
 * 옛 floor(1e6)에서는 콘텐츠 폭이 ~1e3이라 cutoff가 floor(1e6)에 지배당해 도면의 780배
 * 거리(<1e6)의 쓰레기가 통과, bounds를 4e5×7e5로 오염시켜 Zoom Extents가 도면을 화면의
 * 0.3%로 찌그러뜨렸다. floor를 1e4로 낮추면 cutoff는 K×robustExtent(~3.4e4)가 지배해
 * 쓰레기 6개가 폐기되고 bounds가 실규모로 돌아온다.
 */
describe('computeOutlierCriteria — floor 교정(실도면 3e5~7e5 쓰레기 폐기)', () => {
  /** 실도면 콘텐츠 복제: (CX,CY) 중심으로 폭 ~1276·높이 ~782 밀집 격자 nx×ny. */
  function realBody(cx: number, cy: number): Center[] {
    const out: Center[] = [];
    const nx = 20;
    const ny = 13;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        out.push({ x: cx - 638 + (i / (nx - 1)) * 1276, y: cy - 391 + (j / (ny - 1)) * 782 });
      }
    }
    return out;
  }

  it('(a) 콘텐츠 span ~1276 + 3e5~7e5 쓰레기 6개 → 쓰레기만 폐기, bounds 실규모', () => {
    const CX = 217490;
    const CY = 331075;
    const body = realBody(CX, CY); // 260개, 폭 1276 × 782
    // AZ0802 처럼 좌표 부호가 뒤집힌 3.3e5~6.7e5 체비쇼프 거리 쓰레기 6개.
    const garbage: Center[] = [
      { x: CX - 3.4e5, y: CY - 3.5e5 },
      { x: CX - 6.7e5, y: CY + 2.0e5 },
      { x: CX + 3.31e5, y: CY - 4.0e5 },
      { x: -174160, y: -339789 },
      { x: CX - 5.0e5, y: CY - 5.0e5 },
      { x: CX - 6.71e5, y: CY - 3.3e5 },
    ];
    const all = [...body, ...garbage];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    // cutoff는 floor(1e6)가 아니라 K×robustExtent(도면 규모 비례, ~3e4)가 지배해야 한다.
    expect(criteria.cutoff).toBeLessThan(1e5);
    expect(criteria.cutoff).toBeGreaterThan(OUTLIER_ABSOLUTE_FLOOR);
    const drop = classifyCenterOutliers(all, criteria);
    // 본체는 전부 유지
    for (let i = 0; i < body.length; i++) expect(drop[i]).toBe(false);
    // 쓰레기 6개는 전부 폐기(고립·소수라 클러스터 보호 대상 아님)
    let dropped = 0;
    for (let i = body.length; i < all.length; i++) if (drop[i] === true) dropped += 1;
    expect(dropped).toBe(6);
    // 폐기 후 bounds 실규모(폭 ~1276, maxX < 1e5 아님 — 실좌표 2e5대지만 음수/거대는 없음)
    const kept = all.filter((_, i) => drop[i] !== true);
    const xs = kept.map((c) => c.x);
    const ys = kept.map((c) => c.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    expect(spanX).toBeLessThan(2e3);
    expect(spanY).toBeLessThan(2e3);
    expect(Math.min(...xs)).toBeGreaterThan(0); // 음수 minX 없음
  });

  it('(b) 정상 먼 부속(도면 3~5배 거리)은 floor 교정 후에도 유지', () => {
    // 콘텐츠 폭 ~1276 → cutoff ~3.4e4. 도면 3~5배(4e3~6e3) 거리 부속은 cutoff 안이라 유지.
    const CX = 217490;
    const CY = 331075;
    const body = realBody(CX, CY);
    const criteria = computeOutlierCriteria(body);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    const nearAnnex: Center[] = [
      { x: CX + 4e3, y: CY }, // 도면 폭 ~3배
      { x: CX, y: CY + 3e3 }, // 도면 높이 ~4배
      { x: CX - 5e3, y: CY - 5e3 },
    ];
    for (const c of nearAnnex) expect(isRelativeOutlier(c, criteria)).toBe(false);
  });

  it('(c) 초소형 도면은 floor 교정 후에도 과폐기 없음', () => {
    // 폭 ~20 초소형 도면 → cutoff = floor(ABSOLUTE_FLOOR=1e4). 도면 크기의 수백 배지만
    // floor 안(도면 부속 보호창)의 요소는 유지. floor를 낮췄어도 과폐기가 생기지 않는다.
    const tiny = cluster(0, 0, 10, 5); // 25개, 폭 20
    const criteria = computeOutlierCriteria(tiny);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    expect(criteria.cutoff).toBe(OUTLIER_ABSOLUTE_FLOOR);
    const withAnnex = [...tiny, { x: OUTLIER_ABSOLUTE_FLOOR * 0.9, y: 0 }];
    const drop = classifyCenterOutliers(withAnnex, criteria);
    for (const d of drop) expect(d).toBe(false); // 아무것도 폐기 안 됨
  });

  it('(d) 정상 다중 클러스터(합리적 거리)는 floor 교정 후에도 둘 다 유지', () => {
    // 두 덩어리(각 폭 ~2e5, 간격 3e5)는 합쳐진 분포 폭이 커져 cutoff가 충분히 커진다.
    const a = cluster(0, 0, 1e5, 6);
    const b = cluster(3e5, 0, 1e5, 6);
    const all = [...a, ...b];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    const drop = classifyCenterOutliers(all, criteria);
    for (const d of drop) expect(d).toBe(false);
  });

  /**
   * (e) **수용된 트레이드오프 경계 고정**(review major #1, confidence LOW·비차단).
   *
   * floor를 1e6→1e4로 낮춘 대가: compact 실규모 도면(폭 ~1276)에서 cutoff가
   * K×robustExtent(~3.4e4)로 붕괴하므로, 아래 세 조건을 **동시에** 만족하는 고립된 정상
   * 부속(북방위표·스케일바·상세 콜아웃)은 조용히 폐기된다 —
   *   (1) 확장 결과 엔티티 < MIN_ENTITIES_FOR_RELATIVE(8) → 응집 클러스터 보호를 못 받고,
   *   (2) 중앙값에서 cutoff의 수십 배(여기 ~26×) 밖에 있으며,
   *   (3) 전체 중심의 5% 미만이라 p5~p95 트림으로 fullRangeSpan에 안 잡혀 cutoff를 키우지 못한다.
   * 옛 floor(1e6)는 이런 부속을 1e6까지 보호했다. 이는 3e5~7e5 쓰레기를 확실히 잡기 위한
   * **의도된 비용**이며(실도면 여수로 굴착계획 평면도), 완화 장치가 충분하다:
   * 실제 부속은 대개 ≥8 엔티티로 확장돼 거리와 무관하게 응집 보호를 받고((a) 테스트),
   * 엔티티가 적은 도면에서는 부속이 fullRangeSpan을 키워 살아남는다.
   *
   * 이 테스트는 그 폐기가 **의도된 동작**임을 명시적으로 고정한다(무언의 회귀가 아니라
   * 문서화된 경계). 폐기 대신 보호로 바꾸려면 floor에 robustExtent 비례항을 넣는 방안이
   * 있으나, cutoff = max(floor, K×robustExtent)에서 C < K인 C×robustExtent 항은 항상
   * K×robustExtent에 지배당해 무효이므로(실효 없음) 채택하지 않는다.
   */
  it('(e) [수용된 경계] compact 본체 + <MIN 고립 먼 부속은 폐기된다(문서화된 트레이드오프)', () => {
    // 본체: 폭 ~1274, 200개 밀집. 부속: 본체에서 ~5e5(≈26×cutoff) 떨어진 3개(<MIN=8).
    const main: Center[] = [];
    for (let i = 0; i < 200; i++) {
      main.push({ x: 1e5 + (i % 14) * 98, y: 1e5 + Math.floor(i / 14) * 98 });
    }
    const CX = 1e5;
    const CY = 1e5;
    const loneAnnex: Center[] = [
      { x: CX + 5e5, y: CY },
      { x: CX + 5e5 + 50, y: CY },
      { x: CX + 5e5, y: CY + 50 },
    ];
    expect(loneAnnex.length).toBeLessThan(MIN_ENTITIES_FOR_RELATIVE); // 응집 보호 대상 아님
    const all = [...main, ...loneAnnex];
    const criteria = computeOutlierCriteria(all);
    expect(criteria).not.toBeNull();
    if (criteria === null) return;
    // cutoff는 K×robustExtent(도면 규모 비례, ~3.4e4)가 지배 — 옛 1e6 창이 아니다.
    expect(criteria.cutoff).toBeLessThan(1e5);
    // 부속은 cutoff 밖 후보다(부속이 5% 미만이라 fullRangeSpan을 못 키움).
    expect(isRelativeOutlier(loneAnnex[0] as Center, criteria)).toBe(true);
    const drop = classifyCenterOutliers(all, criteria);
    // 본체는 전부 유지.
    for (let i = 0; i < main.length; i++) expect(drop[i]).toBe(false);
    // <MIN 고립 부속은 폐기 — 수용된 트레이드오프(문서화된 경계).
    for (let i = main.length; i < all.length; i++) expect(drop[i]).toBe(true);
  });
});
