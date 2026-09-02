/**
 * 상대 좌표 이상치 검출 — 절대 임계(sanitize.ts의 COORD_SANE_LIMIT=1e12) 아래이지만
 * 도면의 나머지 콘텐츠 대비 극단적으로 멀리 떨어졌거나(중심 이동) 극단적으로 큰(span 팽창)
 * 엔티티를 걸러낸다.
 *
 * 근본 배경: 일부 변환 DXF에는 좌표 성분이 개별적으로는 1e12 미만이라 절대-임계
 * 위생처리를 통과하지만, 엔티티 하나의 bbox가 실제 도면에서 수억~수천억 단위로 벗어나거나
 * 그만큼 커진 "쓰레기" 엔티티가 섞인다(예: 폴리라인 정점 하나만 ~1e11). 이 한 건이
 * model.bounds를 1조 규모로 오염시켜 Zoom Extents가 실제 도면을 세로선 하나로
 * 찌그러뜨린다. 절대 임계를 낮추면 정상 mm 측량좌표(최대 ~1e8~1e9 가능)를 오폐기할
 * 위험이 있으므로, 도면 자체 좌표 분포를 기준으로 한 상대 이상치로 검출한다.
 *
 * 설계 원칙(보수성):
 * - 도면의 견고 산포(robustExtent, MAD)를 실제 규모로 잡고, 그 수백 배(K) 또는
 *   작은-도면 방어 하한(floor) 중 큰 값을 cutoff로 삼는다.
 * - floor는 고정 절대값이 아니라 **중심점 전체 범위(p5~p95 span)에 비례**해 도면 크기에
 *   따라 커진다. 이렇게 하지 않으면(고정 큰 절대창, 예: 1e6) 실제 콘텐츠가 폭 ~1e3인 도면에서
 *   floor가 cutoff를 지배해 도면의 수백 배 거리(<1e6)의 쓰레기 좌표까지 이상치로 못 잡아
 *   bounds를 오염시킨다. 절대 하한(OUTLIER_ABSOLUTE_FLOOR)은 도면 크기를 신뢰 못 하는
 *   퇴화적 초소형 케이스에서만 지배하는 안전 최소값으로 낮게 잡는다.
 * - 정상적으로 도면에서 몇 배 떨어진 콘텐츠(북방위표·범례 등)는 절대 걸리지 않는다.
 * - cutoff를 넘는 중심점이라도 **서로 뭉쳐 있는 소수 클러스터(≥ MIN_ENTITIES_FOR_RELATIVE)**
 *   면 정상 부속(제2 도곽·범례 블록)으로 보고 폐기하지 않는다. 고립된(뭉치지 않은) 점만
 *   폐기한다.
 * - 엔티티 수가 적으면(< MIN_ENTITIES_FOR_RELATIVE) 분포를 신뢰할 수 없어 상대 검출을
 *   생략한다(절대 임계만).
 * - 중심 이동뿐 아니라 **span 팽창**(중심은 도면 안이지만 bbox가 1e11 규모)도 검출한다.
 * - 순수 함수로 분리해 단위 테스트한다.
 */

/** 상대 이상치 검출을 시도할 최소 엔티티(중심점) 수. 이보다 적으면 분포 신뢰 불가 → 생략. */
export const MIN_ENTITIES_FOR_RELATIVE = 8;

/**
 * 견고 산포에 곱하는 배수. 정상 콘텐츠(도면 크기의 몇 배 거리)는 절대 걸리지 않도록 크게 잡는다.
 * 도면 규모의 K배 이상 벗어난 것만 이상치.
 */
export const OUTLIER_K = 100;

/**
 * cutoff 하한(**퇴화적 초소형 도면 방어**)의 절대 최소값. floor는 이 값과 도면 전체 범위
 * 비례분 중 큰 값이고, 실제 cutoff는 다시 K × robustExtent와의 큰 값이다. 따라서 이 상수는
 * "도면 규모를 신뢰할 수 없을 만큼 초소형·퇴화적일 때"만 지배하는 안전 하한일 뿐이다.
 *
 * 낮게 잡는 이유(핵심): 이 값이 크면(예: 1e6) 실제 콘텐츠가 폭 ~1e3 규모인 도면에서 floor가
 * cutoff를 통째로 지배(1e6)해, **도면의 780배 거리**까지 이상치를 허용한다. 그 결과 좌표
 * 부호가 뒤집힌 3e5~7e5 규모 쓰레기 폴리라인(<1e6)이 통과해 bounds를 4e5×7e5로 오염시키고
 * Zoom Extents가 실제 도면을 화면의 0.3%로 찌그러뜨린다(실도면 여수로 굴착계획 평면도 사례).
 * floor를 실측 좌표 mm 규모(~1e5~1e6)에 맞출 필요는 없다 — 그 규모의 도면이라면 K×robustExtent가
 * 이미 지배하기 때문이다. floor는 도면 크기 정보가 없는 퇴화 케이스의 최소 안전창이면 충분하다.
 */
export const OUTLIER_ABSOLUTE_FLOOR = 1e4;

/**
 * floor를 도면 크기에 비례시키는 계수. floor = max(ABSOLUTE_FLOOR, FRACTION × 전체범위span).
 * 전체범위span은 중심점 x·y의 p5~p95 폭 중 큰 값(극단값 트림). 큰 계수라 도면 크기의 여러 배
 * 거리(정상 부속)를 넉넉히 감싸, compact 도면에서도 정상 부속이 걸리지 않는다. 정상 규모 도면은
 * 이 비례분이 ABSOLUTE_FLOOR를 넘어 cutoff가 도면 크기에 따라 커진다(고정창 아님).
 */
export const FLOOR_RANGE_FRACTION = 10;

/** 엔티티 bbox 중심 좌표 한 개 */
export interface Center {
  x: number;
  y: number;
}

/**
 * 정렬된 오름차순 배열에서 백분위 값(선형 보간 없이 최근접 인덱스). 빈 배열이면 NaN.
 * p는 0~100. 경계는 클램프한다.
 */
export function percentileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0] as number;
  const clampedP = Math.min(100, Math.max(0, p));
  const idx = Math.round((clampedP / 100) * (n - 1));
  const i = Math.min(n - 1, Math.max(0, idx));
  return sorted[i] as number;
}

/** 값 배열의 중앙값. 정렬본을 만들어 계산한다. 빈 배열이면 NaN. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return percentileSorted(sorted, 50);
}

/**
 * 한 축 값 집합의 중앙값 절대편차(MAD) — median(|vᵢ − median(v)|).
 * 백분위 폭과 달리 **와해점(breakdown point)이 50%**라, 표본이 적어도(예: 13개 중 1개)
 * 단일 극단 이상치가 산포를 부풀리지 못한다. 백분위 폭(2.5~97.5)은 소표본에서 이상치가
 * 상위 2.5% 안에 들어와 산포를 오염시켰다(예: 13개면 p97.5 인덱스가 이상치를 집는다).
 */
function mad(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  return median(values.map((v) => Math.abs(v - med)));
}

/**
 * 중심점 집합의 견고 산포 — x·y 각각 MAD의 최대.
 * 도면의 실제 규모(밀집 콘텐츠의 중앙 퍼짐)를 극단값에 둔감하게 잡는 값. 중심이 없으면 0.
 * MAD 기반이라 소수의 극단 이상치가 섞여도 오염되지 않는다(다중 이상치까지 방어).
 */
export function robustExtent(centers: readonly Center[]): number {
  if (centers.length === 0) return 0;
  const madX = mad(centers.map((c) => c.x));
  const madY = mad(centers.map((c) => c.y));
  return Math.max(madX, madY);
}

/**
 * 중심점 전체 범위 — x·y 각각 p5~p95 폭 중 큰 값. floor를 도면 크기에 비례시키는 데 쓴다.
 * p5~p95로 극단 이상치를 트림하되, robustExtent(MAD)보다 넓은 실제 도면 폭을 잡는다.
 * (MAD는 밀집 중앙만 보므로 정상 부속을 감싸기엔 좁을 수 있다.) 중심이 없으면 0.
 */
export function fullRangeSpan(centers: readonly Center[]): number {
  if (centers.length === 0) return 0;
  const xs = centers.map((c) => c.x).sort((a, b) => a - b);
  const ys = centers.map((c) => c.y).sort((a, b) => a - b);
  const spanX = percentileSorted(xs, 95) - percentileSorted(xs, 5);
  const spanY = percentileSorted(ys, 95) - percentileSorted(ys, 5);
  return Math.max(spanX, spanY);
}

/** 상대 이상치 판정 기준 — 중앙값 중심과 cutoff(허용 반경). */
export interface OutlierCriteria {
  medX: number;
  medY: number;
  /** 중앙값 중심에서 허용하는 최대 편차(체비쇼프 반경). 이보다 멀거나 span이 이보다 크면 이상치 후보. */
  cutoff: number;
  /** 소수 뭉침 클러스터를 정상 부속으로 인정하는 최소 구성원 수. */
  minCluster: number;
}

/**
 * 중심점 분포로부터 상대 이상치 판정 기준을 계산한다.
 * 엔티티(중심) 수가 MIN_ENTITIES_FOR_RELATIVE 미만이면 분포를 신뢰할 수 없어 null(검출 생략).
 *
 * cutoff = max(floor, K × robustExtent),
 * floor = max(ABSOLUTE_FLOOR, FLOOR_RANGE_FRACTION × fullRangeSpan):
 * - robustExtent가 작은 도면은 floor가 지배. floor 자체가 도면 전체 범위에 비례하므로
 *   compact 도면이라도 고정 절대창이 아니라 도면 크기의 여러 배를 감싼다 → 정상 부속 보호.
 * - 큰 도면은 K × robustExtent가 지배 → 규모의 수백 배 벗어난 것만 이상치.
 */
export function computeOutlierCriteria(
  centers: readonly Center[],
  opts?: {
    k?: number;
    absoluteFloor?: number;
    minEntities?: number;
    floorRangeFraction?: number;
  },
): OutlierCriteria | null {
  const k = opts?.k ?? OUTLIER_K;
  const absoluteFloor = opts?.absoluteFloor ?? OUTLIER_ABSOLUTE_FLOOR;
  const minEntities = opts?.minEntities ?? MIN_ENTITIES_FOR_RELATIVE;
  const floorRangeFraction = opts?.floorRangeFraction ?? FLOOR_RANGE_FRACTION;
  if (centers.length < minEntities) return null;
  const medX = median(centers.map((c) => c.x));
  const medY = median(centers.map((c) => c.y));
  const extent = robustExtent(centers);
  const floor = Math.max(absoluteFloor, floorRangeFraction * fullRangeSpan(centers));
  const cutoff = Math.max(floor, k * extent);
  return { medX, medY, cutoff, minCluster: minEntities };
}

/** 두 중심의 체비쇼프 거리(max(|Δx|, |Δy|)). */
function chebyshev(a: Center, b: Center): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 중심점이 상대 이상치 후보인가 — 중앙값 중심에서 cutoff를 초과해 떨어졌는가(체비쇼프 거리).
 * bbox 중심 기준이므로 도면 안에 일부만 걸치는(중심은 안쪽) 엔티티는 유지되고,
 * 중심 자체가 도면에서 극단적으로 벗어난 것만 후보로 잡는다.
 *
 * 주의: 이 함수는 "후보"만 판정한다. 실제 폐기 여부는 뭉침 클러스터 여부까지 본
 * classifyCenterOutliers를 사용한다(정상 제2 클러스터 보호).
 */
export function isRelativeOutlier(center: Center, criteria: OutlierCriteria): boolean {
  return (
    Math.abs(center.x - criteria.medX) > criteria.cutoff ||
    Math.abs(center.y - criteria.medY) > criteria.cutoff
  );
}

/**
 * span(엔티티 bbox의 max(폭, 높이))이 상대 이상치인가 — 도면 규모 대비 극단적으로 큰가.
 * 중심은 도면 안이지만 정점 하나가 ~1e11이라 span만 1e11로 부푼 엔티티(대칭 손상)를 잡는다.
 * 이런 엔티티는 bbox 중심이 도면 안이라 중심-기반 검출로는 못 잡지만 bounds를 오염시킨다.
 */
export function isSpanOutlier(span: number, criteria: OutlierCriteria): boolean {
  return span > criteria.cutoff;
}

/**
 * 중심-기반 이상치 후보들을 실제 폐기 대상과 보호 대상(정상 제2 클러스터)으로 분류한다.
 *
 * 정상 부속(범례·북방위표·상세도·제2 도곽) 보호: cutoff를 넘는 중심점이라도 **서로 cutoff
 * 이내로 뭉쳐 있는 무리(연결 성분)의 크기가 minCluster 이상**이면 정상 콘텐츠로 보고 폐기하지
 * 않는다. 고립되었거나(연결 성분 크기 < minCluster) 소수만 뭉친 무리만 폐기한다.
 *
 * 뭉침 판정은 후보 중심들 사이의 체비쇼프 거리 ≤ cutoff를 간선으로 하는 연결 성분으로 한다.
 * (밀집 본체와의 거리가 아니라 후보끼리의 상호 거리 기준 — 제2 클러스터의 내부 응집을 본다.)
 *
 * @returns candidates 각 원소에 drop(폐기 여부) 부여. 후보가 아니면(중심이 cutoff 안) 애초에
 *   candidates에 포함되지 않는다.
 */
export function classifyCenterOutliers(
  centers: readonly Center[],
  criteria: OutlierCriteria,
): boolean[] {
  const n = centers.length;
  // 각 중심의 후보 여부(cutoff 초과)
  const candidate = centers.map((c) => isRelativeOutlier(c, criteria));
  const drop = new Array<boolean>(n).fill(false);
  // 후보들의 인덱스만 모아 연결 성분(뭉침) 분석
  const candIdx: number[] = [];
  for (let i = 0; i < n; i++) if (candidate[i]) candIdx.push(i);
  // Union-Find: 후보끼리 cutoff 이내면 같은 무리
  const parent = candIdx.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    let cur = x;
    while (parent[cur] !== r) {
      const next = parent[cur] as number;
      parent[cur] = r;
      cur = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < candIdx.length; i++) {
    for (let j = i + 1; j < candIdx.length; j++) {
      const ci = centers[candIdx[i] as number] as Center;
      const cj = centers[candIdx[j] as number] as Center;
      if (chebyshev(ci, cj) <= criteria.cutoff) union(i, j);
    }
  }
  // 무리별 구성원 수 집계
  const groupSize = new Map<number, number>();
  for (let i = 0; i < candIdx.length; i++) {
    const root = find(i);
    groupSize.set(root, (groupSize.get(root) ?? 0) + 1);
  }
  // minCluster 미만 무리(고립/소수)만 폐기
  for (let i = 0; i < candIdx.length; i++) {
    const root = find(i);
    if ((groupSize.get(root) ?? 0) < criteria.minCluster) {
      drop[candIdx[i] as number] = true;
    }
  }
  return drop;
}
