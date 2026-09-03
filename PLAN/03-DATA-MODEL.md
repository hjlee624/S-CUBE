# S-CUBE — 데이터 모델

모든 타입은 `packages/schema` 에 정의하고 Zod 스키마를 함께 둔다.
길이 단위는 내부적으로 **항상 미터(m)** 로 정규화한다.

## 1. 도면

```ts
type DrawingId = string;   // uuid
type EntityHandle = string; // DXF handle (5 그룹코드) — 역추적 키

interface Drawing {
  id: DrawingId;
  fileName: string;
  filePath: string;          // 절대경로 (임베드 안 함)
  sha256: string;            // 교체·수정 감지
  dxfVersion: string;        // AC1015 등
  insUnits: InsUnits;        // $INSUNITS 원값
  calibration: Calibration | null;  // null이면 측정 차단
  layers: Layer[];
  loadedAt: string;          // ISO8601
}

interface Calibration {
  method: 'two-point' | 'header-units';
  p1: Vec2; p2: Vec2;        // 도면 좌표
  drawingDistance: number;   // 두 점 사이 도면상 거리
  realDistance_m: number;    // 사용자가 입력한 실제 거리
  scale: number;             // realDistance_m / drawingDistance
  verifiedBy?: { handle: EntityHandle; expected_m: number; error_pct: number }[];
  calibratedAt: string;
}
```

## 2. 정규화 엔티티

DXF 원본 구조를 그대로 쓰지 않고 아래로 정규화한다.
블록(INSERT)은 재귀 전개하여 world 좌표로 평탄화하되, 출처를 남긴다.

```ts
type NEntity =
  | { kind: 'line';    handle: EntityHandle; layer: string; a: Vec2; b: Vec2 }
  | { kind: 'polyline';handle: EntityHandle; layer: string; vertices: PVertex[]; closed: boolean }
  | { kind: 'arc';     handle: EntityHandle; layer: string; center: Vec2; r: number; a0: number; a1: number }
  | { kind: 'circle';  handle: EntityHandle; layer: string; center: Vec2; r: number }
  | { kind: 'hatch';   handle: EntityHandle; layer: string; loops: Loop[] }
  | { kind: 'text';    handle: EntityHandle; layer: string; pos: Vec2; value: string; height: number }
  | { kind: 'dimension';handle: EntityHandle; layer: string;
                        defPoints: Vec2[]; measured_m: number; textOverride: string | null };

interface PVertex { p: Vec2; bulge: number }   // bulge ≠ 0 → 원호 세그먼트
interface Loop { vertices: PVertex[]; isOuter: boolean }

// 블록 전개 출처
interface EntityOrigin { blockPath: string[]; transform: Mat3 }
```

> `dimension.textOverride`가 있으면 UI에서 **경고 배지**를 띄우고,
> 수량에는 `measured_m`(좌표 실측값)을 쓴다.

## 3. 측정

```ts
interface Measurement {
  id: string;
  drawingId: DrawingId;
  kind: 'area' | 'length';
  value: number;             // area: ㎡, length: m (캘리브레이션 적용 후)
  rawValue: number;          // 도면 단위 원값 (검증용)
  method: 'polyline' | 'hatch' | 'auto-boundary' | 'entity-chain'
        | 'profile-cut-fill'   // 원지반·계획선 2클릭 자동 절토/성토 (FR-3.10)
        | 'dimension' | 'manual';
  sourceHandles: EntityHandle[];
  cutFill?: 'cut' | 'fill';    // method='profile-cut-fill'일 때 부호 구분(절토/성토)
  holes?: EntityHandle[];    // 차감된 내부 영역
  label: string;             // "절토부", "옹벽 본체" 등 사용자 명명
  createdAt: string;
}
```

## 4. 측점 · 구간

```ts
// "No.8+0.000(전)" 파싱 결과 — 단, 번호만으로도 유효
interface Station {
  raw?: string;              // 원본 표기(있으면). 번호만 입력 시 생략 가능
  label?: string;            // 자유 입력 라벨 허용 (표기규격 미준수도 1급 허용)
  no: number;                // 8  (측점 번호 — 최소 필수)
  plus_m?: number;           // 0.000  (옵셔널: +거리 표기가 있을 때만)
  chainage_m: number;        // 번호×stationInterval (+ plus_m 있으면 가산)
  discontinuity: 'pre' | 'post' | null;  // 전/후
}
```

> **표기규격 미준수 측점도 1급 허용.** 사용자는 `No.8+0.000` 강제 없이 **번호만**
> 입력해도 된다. `plus_m`가 없으면 `chainage_m = no × stationInterval_m`로 파생하고,
> `+거리`가 있으면 가산한다. 자유 `label`도 허용하되 정렬은 `chainage_m` 기준.

```ts
interface StationSection {
  id: string;
  station: Station;
  itemKey: string;           // '절토', '성토', '표토제거' 등
  area_m2: number;
  measurementId?: string;    // 도면 측정 출처 (수동 입력이면 undefined)
  note?: string;
}

interface Segment {
  from: Station; to: Station;
  length_m: number;          // to.chainage - from.chainage
  itemKey: string;
  a1: number; a2: number;    // 양단 단면적
  volume_m3: number;         // (a1+a2)/2 * L
  method: 'average-end-area' | 'prismoidal';
}
```

### 전/후 불연속 처리 규칙
동일 chainage에 `(전)`, `(후)` 두 단면이 있을 때:
- 앞 구간은 `(전)` 단면을 종점 단면으로 사용
- 뒤 구간은 `(후)` 단면을 시점 단면으로 사용
- 두 단면 사이 연장은 **0** — 체적 발생시키지 않음
- `(전)` 단면 값이 비어 있으면 **에러로 승격**하고 산출을 막는다
  (곡성 No.8+0.000(전) 절토량 누락 사례 재발 방지)

## 5. 규격 마스터

```ts
interface MaterialSpec {
  code: string;              // 'CONC-25-24-15'
  workType: string;          // 공종: '구조물공'
  name: string;              // '콘크리트'
  spec: string;              // '25-24-15'
  unit: string;              // '㎥'
  conversions?: {            // 단위 환산
    toUnit: string;          // 'ton'
    factor: number;          // 2.35
    note?: string;
  }[];
  lossRate?: number;         // 할증률 0.03 = 3%
  standardLength_m?: number; // 정척 (m → 본)
  thickness_m?: number;      // area-thickness 유형용 두께 (규격에서 읽음, 하드코딩 금지)
}
```

> **두께 규칙(area-thickness):** 면적×두께 계산의 두께는 **규격(MaterialSpec)에서
> 읽는다**. `thickness_m`(또는 `spec` 문자열 파싱)이 없는 규격은 area-thickness 항목
> 추가를 **차단하거나 경고**한다 — UI의 조용한 `0.1` 하드코딩 금지. basis의 두께노드
> `label`에 규격 출처를 남겨 역추적을 유지한다.

## 6. 산출 항목 · 산출근거

### 계산유형 (CalcType) — BOQ 다공종 대응

```ts
// docs/quantity-calc-taxonomy.md 8종과 1:1. 양단면평균법(section-length)은 이 중 하나.
type CalcType =
  | 'section-length'   // 단면적 × 연장 (양단면평균법/각주법)   → avgEndArea
  | 'area-thickness'   // 면적 × 두께 (두께는 규격에서)           → mul(area, thickness)
  | 'area'             // 폐합영역 면적 직접                      → area 측정값
  | 'contact-length'   // 접촉둘레 × 연장 (파생 면적: 거푸집 등)  → mul(contact, length)
  | 'length'           // 선형 연장 직접                          → length 측정값
  | 'count'            // 개수 집계 (심볼/블록)                   → mul(count, per)
  | 'ref'              // 다른 항목 참조 파생 (합·차·계수)        → ref/add/sub/mul
  | 'manual';          // 수동 입력 (도면 외 수량, FR-4.7)        → const
```

각 유형은 위 매핑대로 `FormulaNode` 트리를 자동 생성한다. `conversions`(단위환산)와
`lossRate`(할증)는 유형과 **직교**로 어느 유형에든 덧씌운다.

**구현 유형 vs 미지원 유형** (커버리지 가시화 — core `calc.ts` 빌더와 1:1):

| CalcType | core 빌더 | 자동 취득 | 비고 |
|---|---|---|---|
| section-length | `sectionLength` | ✅ 측점 연장 | 핵심 |
| area-thickness | `areaThickness` | ✅ 두께=규격 | 두께 규격연동 필수(하드코딩 금지) |
| area | (측정값 직결) | ✅ | HATCH 면적은 파서 보강 대기(R-6) |
| contact-length | `contactLength` | ⚠ 부분 | 접촉변 자동판별은 P4-9-1에서 보강 |
| length | (측정값 직결) | ✅ | |
| count | `countTimes` | ⚠ 수동 | 자동 블록카운트는 Phase 5 |
| ref | `applyLoss`/`convertUnit` 등 | ✅ | FormulaNode 조합 |
| manual | (const) | — | 입력만 |

```ts
interface TakeoffItem {
  id: string;
  workType: string;          // 공종
  specCode: string;          // MaterialSpec.code
  unit: string;
  calcType: CalcType;        // ★ 계산유형 — 수량식 생성 규칙 결정
  quantity: number;          // 계산 결과 (캐시)
  basis: FormulaNode;        // ★ 산출근거 트리
  sourceRefs: { drawingId: DrawingId; handles: EntityHandle[] }[];
}

// 수량 소스 — 측정/구간/수동/참조/파생
type TakeoffSource =
  | { kind: 'measurement'; measurementId: string }
  | { kind: 'segment';     segmentId: string }
  | { kind: 'manual';      value: number }
  | { kind: 'ref';         itemId: string }
  // 파생 소스 — 원본(콘크리트 등) 항목 기하에서 자동 조립, 상수 대신 fRef로 역추적 유지
  | { kind: 'derived-contact';  sourceItemId: string; fRef: FormulaNode }  // 거푸집=접촉둘레×연장
  | { kind: 'derived-scaffold'; sourceItemId: string; fRef: FormulaNode }  // 비계=외주둘레×높이
  | { kind: 'derived-shore';    sourceItemId: string; fRef: FormulaNode }; // 동바리=수평면적×타설높이
```

> **파생 소스**는 두께/높이 상수를 사람이 넣지 않고, 원본 콘크리트 항목의 handle을
> `sourceRefs`로 물어 도면 기하(`fRef`)로 조립한다. 사람이 판단·입력하는 것은
> 높이/타설고 정도로 한정 — 계수 직접입력 방식은 반자동 의도(원칙 1)와 배치된다.

```ts
// 산출근거 트리 — 엑셀 수식으로 렌더 가능해야 함
type FormulaNode =
  | { op: 'const';  value: number; label?: string }
  | { op: 'ref';    cell: string;  label: string }   // 다른 시트 셀 참조
  | { op: 'add' | 'sub' | 'mul' | 'div'; args: FormulaNode[] }
  | { op: 'avgEndArea'; a1: FormulaNode; a2: FormulaNode; length: FormulaNode }
  | { op: 'sum';    args: FormulaNode[] }
  | { op: 'round';  arg: FormulaNode; digits: number }
  | { op: 'loss';   arg: FormulaNode; rate: number };
```

`FormulaNode` → 엑셀 수식 변환 예:
```
avgEndArea(ref('상세!D12'), ref('상세!D13'), ref('상세!E12'))
  →  =(상세!D12+상세!D13)/2*상세!E12
```

## 7. 프로젝트 파일 (.scube)

```ts
interface ScubeProject {
  schemaVersion: 1;
  meta: {
    projectName: string;     // '곡성 지구 도로확포장'
    author: string;
    createdAt: string; updatedAt: string;
    stationInterval_m: number;  // 통상 20
  };
  drawings: Drawing[];
  measurements: Measurement[];
  sections: StationSection[];
  items: TakeoffItem[];
  specs: MaterialSpec[];
  history: ChangeLogEntry[];
}
```

JSON, UTF-8. Zod로 로드 시 검증하고 `schemaVersion` 마이그레이션 경로를 둔다.
