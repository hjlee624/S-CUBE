# S-CUBE

> **S-CUBE** (에스큐브) — *Saman Quantity Cube*
> 단면(㎡) × 연장(m) = 체적(㎥). 도면에서 바로 수량을 산출하는 토목 수량산출 도구.

DXF 도면에서 단면적과 연장을 직접 취득하고, 재료 규격을 입력하면
**산출근거가 수식으로 살아 있는 수량산출서(xlsx)** 를 생성한다.

---

## 무엇을 하는가

1. **도면 로드** — DXF를 열고 축척을 캘리브레이션한다
2. **측정** — 단면 폴리라인을 클릭하면 면적, 선·치수를 클릭하면 연장이 나온다
3. **산출** — 측점별 단면적을 모아 양단면평균법으로 체적을 계산한다
4. **규격** — 재료 규격과 할증·환산을 적용한다
5. **출력** — 산출근거 상세형 수량산출서를 엑셀로 내보낸다

모든 수량은 **어느 도면의 어느 객체에서 나왔는지** 끝까지 역추적된다.
엑셀 셀에는 값이 아니라 **수식**이 들어가므로 감리·발주처가 계산 과정을 확인할 수 있다.

## 동작 원리

### 산출 파이프라인

```mermaid
flowchart LR
    DXF["DXF 파일"] -->|"① Web Worker 파싱"| RAW["RawDxf<br/>header · tables · blocks · entities"]
    RAW -->|"② 블록 재귀 전개<br/>변환행렬 누적 · 정규화"| DM["DrawingModel<br/>NEntity[] (world 좌표)"]
    DM -->|"③ 캘리브레이션<br/>scale = 실거리 ÷ 도면거리"| CAL["CalibratedDrawing"]
    CAL -->|"④ 클릭 히트테스트<br/>R-tree → 정밀 판정"| MEAS["Measurement<br/>면적 ㎡ · 연장 m<br/>+ 원본 handle (역추적)"]
    MEAS -->|"⑤ 측점·구간 배치"| SEG["StationSection<br/>Segment"]
    SEG -->|"⑥ 양단면평균법"| TAKE["TakeoffItem<br/>basis: FormulaTree"]
    TAKE -->|"⑦ 수식 렌더"| XLSX["수량산출서.xlsx<br/>값이 아닌 수식 삽입"]
```

### 축척 캘리브레이션 — 검증 없이는 산출하지 않는다

```mermaid
flowchart LR
    START["도면 로드"] --> INS["$INSUNITS 헤더로<br/>단위 추정·표시"]
    INS --> PICK["기준선 2점 클릭<br/>(끝점·중점 스냅)"]
    PICK --> INPUT["실제 거리(m) 입력"]
    INPUT --> SCALE["scale = 실거리 ÷ 도면거리"]
    SCALE --> VERIFY{"DIMENSION 대조<br/>오차 % 확인"}
    VERIFY -->|"통과"| ON["측정 도구 활성화"]
    VERIFY -->|"미완료"| OFF["면적·연장 산출 차단<br/>+ 경고 배너"]
```

### 체적 산출 — 양단면평균법과 전/후 불연속 처리

```mermaid
flowchart TD
    SORT["측점 파싱·정렬<br/>chainage = No × 측점간격 + plus"] --> DUP{"동일 chainage에<br/>(전)·(후) 2개 단면?"}
    DUP -->|"아니오"| SEG["인접 측점 쌍으로 구간 생성<br/>L = chainage 차"]
    DUP -->|"예"| SPLIT["앞 구간 종점 = (전) 단면<br/>뒤 구간 시점 = (후) 단면<br/>(전)↔(후) 사이 연장 = 0"]
    SPLIT --> MISS{"(전) 단면 결측?"}
    MISS -->|"예"| ERR["에러 승격 — 산출 차단<br/>(조용히 0 처리 금지)"]
    MISS -->|"아니오"| SEG
    SEG --> VOL["V = (A1 + A2) ÷ 2 × L"]
    VOL --> TREE["FormulaNode 트리로 보관<br/>숫자가 아니라 계산식"]
    TREE --> RENDER["엑셀 수식 렌더<br/>=(상세!D12+상세!D13)/2*상세!E12"]
```

### 패키지 구조

```mermaid
graph TD
    WEB["apps/web<br/>Vite 8 + React 19<br/>Canvas 렌더러 · 측정 UI"] --> CORE
    SRV["apps/server<br/>Hono · 127.0.0.1:5321<br/>대용량 파싱 · 파일 I/O"] --> CORE
    XL["packages/xlsx<br/>ExcelJS 수량산출서"] --> SCHEMA
    CORE["packages/core ★ 순수 계산<br/>dxf · geometry · quantity · station"] --> SCHEMA
    WEB --> SCHEMA["packages/schema<br/>공통 타입 + Zod"]
    SRV --> SCHEMA
```

## 설계 원칙

- **완전자동이 아니라 반자동.** 실무 도면은 폐합되어 있지 않고 레이어 규칙도 제각각이다.
  사람이 판단하고 도구가 계산·기록한다.
- **축척은 반드시 검증한다.** 캘리브레이션 없이는 면적을 산출하지 않는다.
- **원본 도면은 수정하지 않는다.** 읽기 전용.

## 기술 스택

| 항목 | 선택 |
|---|---|
| 런타임 | Node.js 24 LTS |
| 패키지 매니저 | pnpm (workspace) |
| 번들러 | Vite 8 (Rolldown 내장) |
| 언어 | TypeScript (strict) |
| Lint/Format | Biome |
| UI | React 19 + Canvas 2D |
| 서버 | Hono (로컬 전용, 127.0.0.1) |
| Excel | ExcelJS |

## 개발

```bash
pnpm install   # 의존성 설치 (Node 24+, pnpm)
pnpm dev       # 웹(5320) + 로컬 서버(5321) 동시 기동
pnpm check     # Biome lint/format + tsc 타입체크
pnpm test      # Vitest
pnpm build     # 전체 빌드
```

## 현재 상태

**개발 진행 중.** 상세 계획은 [`PLAN/`](./PLAN) 참조.

| 문서 | 내용 |
|---|---|
| [00-OVERVIEW](./PLAN/00-OVERVIEW.md) | 프로젝트 개요·범위·로드맵 |
| [01-REQUIREMENTS](./PLAN/01-REQUIREMENTS.md) | 기능·비기능 요구사항 |
| [02-ARCHITECTURE](./PLAN/02-ARCHITECTURE.md) | 시스템 구조·기술 스택 |
| [03-DATA-MODEL](./PLAN/03-DATA-MODEL.md) | 데이터 모델 |
| [10~16 PHASE](./PLAN) | Phase 0~6 단계별 실행 계획 |
| [20-RISKS](./PLAN/20-RISKS.md) | 리스크 대장 |
| [21-CONVENTIONS](./PLAN/21-CONVENTIONS.md) | 개발 규약 |

### 로드맵

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 스캐폴딩·툴체인 | **완료** |
| 1 | DXF 로드·렌더·캘리브레이션 | **구현 완료** — 실도면 검증 대기 |
| 2 | 면적·연장 측정 | 예정 |
| 3 | 측점·구간·양단면평균법 | 예정 |
| 4 | 규격 마스터 + 엑셀 출력 **(MVP)** | 예정 |
| 5 | 자동 폐합 탐색·레이어 규칙 | 예정 |
| 6 | 검증 리포트·배포 | 예정 |

## 제약

- DWG는 직접 읽지 않는다. **DXF로 저장 후 사용** (Phase 5에서 ODA 변환기 연동 예정)
- 도면 파일은 외부로 전송되지 않는다. 전 기능 오프라인 동작.

---

삼안(주) 이현중(hjlee@samaneng.com) · 토목 수량산출 자동화
