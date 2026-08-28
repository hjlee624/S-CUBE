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
  method: 'polyline' | 'hatch' | 'auto-boundary' | 'entity-chain' | 'dimension' | 'manual';
  sourceHandles: EntityHandle[];
  holes?: EntityHandle[];    // 차감된 내부 영역
  label: string;             // "절토부", "옹벽 본체" 등 사용자 명명
  createdAt: string;
}
```

## 4. 측점 · 구간

```ts
// "No.8+0.000(전)" 파싱 결과
interface Station {
  raw: string;               // 원본 표기
  no: number;                // 8
  plus_m: number;            // 0.000
  chainage_m: number;        // no * stationInterval + plus_m
  discontinuity: 'pre' | 'post' | null;  // 전/후
}

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
}
```

## 6. 산출 항목 · 산출근거

```ts
interface TakeoffItem {
  id: string;
  workType: string;          // 공종
  specCode: string;          // MaterialSpec.code
  unit: string;
  quantity: number;          // 계산 결과 (캐시)
  basis: FormulaNode;        // ★ 산출근거 트리
  sourceRefs: { drawingId: DrawingId; handles: EntityHandle[] }[];
}

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
