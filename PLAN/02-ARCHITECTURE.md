# S-CUBE — 아키텍처

## 1. 전체 구조

```
┌──────────────────────────── 사용자 PC (오프라인) ────────────────────────────┐
│                                                                              │
│   브라우저 (Chrome/Edge)                    로컬 Node 서버 (127.0.0.1:5321)   │
│  ┌───────────────────────────────┐        ┌──────────────────────────────┐   │
│  │ apps/web  (Vite 8 + Rolldown) │        │ apps/server  (Hono/Node 24)  │   │
│  │                               │        │                              │   │
│  │  ┌─────────────────────────┐  │  HTTP  │  • 대용량 DXF 스트림 파싱     │   │
│  │  │ Canvas Renderer         │  │◄──────►│  • 로컬 파일 열기/저장        │   │
│  │  │ (2D, 팬/줌/히트테스트)   │  │        │  • DWG→DXF 변환(ODA, Ph.5)   │   │
│  │  └─────────────────────────┘  │        │  • xlsx 생성                 │   │
│  │  ┌─────────────────────────┐  │        │  • 규격 마스터 저장          │   │
│  │  │ Measure / Station Panel │  │        └──────────────────────────────┘   │
│  │  └─────────────────────────┘  │                       │                  │
│  │  ┌─────────────────────────┐  │                       ▼                  │
│  │  │ Web Worker: dxf parse   │  │            ~/.s-cube/  (설정·규격 마스터) │
│  │  └─────────────────────────┘  │            프로젝트폴더/*.scube           │
│  └───────────────────────────────┘                                          │
│                    │                                                         │
│                    ▼                                                         │
│         packages/core  (순수 TS — 브라우저·서버 공용)                         │
│         DXF 파싱 · 기하 연산 · 수량 계산 · 단위 환산                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**핵심 설계 판단**: 계산 로직(`packages/core`)은 DOM·Node API에 의존하지 않는
순수 TypeScript. 브라우저에서도 서버에서도 동일하게 돌고, 단위 테스트가 쉽다.
UI와 I/O만 환경별로 분리한다.

## 2. 기술 스택

| 레이어 | 선택 | 근거 |
|---|---|---|
| 런타임 | Node.js 24 LTS | 요구사항. 네이티브 TS 스트립·`node:sqlite` 사용 가능 |
| 패키지 매니저 | pnpm (workspace) | 모노레포, 디스크 효율 |
| 번들러/개발서버 | Vite 8 (Rolldown 내장) | 요구사항. Rust 기반, 빌드 대폭 단축 |
| 언어 | TypeScript 5.x (strict) | 도메인 타입 안정성이 수량 오류 방지에 직결 |
| Lint/Format | Biome | 요구사항. ESLint/Prettier 대체 |
| UI | React 19 + Zustand | 상태가 도면·측정·측점으로 복잡. Zustand는 캔버스와 궁합 좋음 |
| 스타일 | Tailwind CSS v4 | 빠른 조판, 별도 CSS 관리 불필요 |
| 렌더링 | Canvas 2D (+ 필요 시 WebGL 승격) | 2D 도면은 Canvas로 충분. WebGL은 성능 미달 시 |
| 서버 | Hono | 경량, Node 24 네이티브 fetch 기반 |
| DXF 파싱 | `dxf-parser` 기반 + 자체 정규화 레이어 | 성숙도. 단, 출력 구조를 그대로 쓰지 않고 내부 모델로 정규화 |
| Excel | ExcelJS | 셀 수식 삽입·서식 제어 필요 |
| 검증 | Zod | 프로젝트 파일·규격 마스터 스키마 검증 |
| 테스트 | Vitest | Vite 통합 |
| E2E | Playwright | 캔버스 상호작용 회귀 방지 |

> **결정 보류 항목**: React vs Solid, Tailwind 채택 여부는 Phase 0에서 확정하고
> `docs/decisions/` 에 ADR로 기록한다.

## 3. 디렉토리 구조

```
S-CUBE/
├─ PLAN/                        # 본 계획 문서
├─ apps/
│  ├─ web/                      # Vite 8 SPA
│  │  ├─ src/
│  │  │  ├─ canvas/             # 렌더러, 히트테스트, 스냅, 좌표 변환, section-area 2클릭
│  │  │  ├─ features/           # calibration, measure, station, takeoff, spec
│  │  │  ├─ features/workspace/ # 다중도면 탭 + 필수도면 체크리스트 (FR-1.5/8.3)
│  │  │  ├─ features/pip/        # 수량 작업대 별도창 Document PiP (FR-8.1/8.2)
│  │  │  ├─ store/              # Zustand 슬라이스
│  │  │  ├─ workers/            # dxf-parse.worker.ts
│  │  │  └─ ui/                 # 공통 컴포넌트 (동적/모션 디자인 — FR-8.4)
│  │  └─ vite.config.ts
│  └─ server/                   # Hono + Node 24
│     └─ src/routes/            # files, convert, export, spec
├─ packages/
│  ├─ core/                     # ★ 순수 계산 로직
│  │  └─ src/
│  │     ├─ dxf/                # 파싱, 정규화, 블록 전개
│  │     ├─ geometry/           # shoelace, bulge, 폴리라인 폐합, 히트테스트
│  │     ├─ quantity/           # 양단면평균법, 단위 환산, 할증
│  │     └─ station/            # 측점 파싱·정렬·불연속 처리
│  ├─ xlsx/                     # 수량산출서 생성 (ExcelJS)
│  └─ schema/                   # 공통 타입 + Zod 스키마 (.scube 포맷)
├─ fixtures/                    # 테스트용 DXF (익명화된 실도면 포함)
├─ docs/
│  ├─ decisions/                # ADR (Architecture Decision Record)
│  └─ experiments/              # 실험 로그
├─ biome.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ README.md
```

> 문서 3계층: **README**(무엇을·어떻게 쓰나) / **decisions**(왜 그렇게 했나) /
> **experiments**(무엇을 시도해봤나). 기존 개발 방식 그대로 유지.

## 4. 데이터 흐름

```
DXF 파일
   │ (1) 파싱 — Web Worker 또는 서버
   ▼
RawDxf { header, tables, blocks, entities }
   │ (2) 정규화 — 블록 재귀 전개, 변환행렬 적용, 좌표 평탄화
   ▼
DrawingModel { layers[], entities[](world 좌표) }
   │ (3) 캘리브레이션 — scale = 실제거리 / 도면거리
   ▼
CalibratedDrawing { ..., unitScale }
   │ (4) 선택 — 클릭 히트테스트 → 엔티티 handle
   │     · 레이어 비의존: 기하·색상·선형·근접성 기반 히트/그룹핑 (레이어는 표시 필터일 뿐)
   │     · 반자동 경로: 원지반·계획선 2클릭 → 두 프로파일 차집합 적분(FR-3.10)
   ▼
Measurement { kind: area|length, value_m, sourceHandles[], method, cutFill? }
   │ (5) 배치 — 측점/구간/항목에 할당
   ▼
TakeoffItem { 공종, 규격, 단위, calcType, 수량, basis: FormulaTree }  // calcType 8종별 수식 생성
   │ (6) 렌더 — FormulaTree → 엑셀 수식 문자열
   ▼
수량산출서.xlsx
```

**`FormulaTree`가 이 설계의 핵심.** 수량을 숫자로 들고 있지 않고
계산 트리로 들고 있어야, 엑셀 셀에 수식을 그대로 심고 역추적할 수 있다.

## 5. 성능 전략

| 병목 | 대응 |
|---|---|
| 대용량 DXF 파싱 | Web Worker + 스트리밍 파서. 50MB 초과 시 서버 위임 |
| 엔티티 렌더 | 뷰포트 컬링 + 공간 인덱스(R-tree) + 오프스크린 캔버스 레이어 캐시 |
| 히트테스트 | R-tree로 후보 축소 후 정밀 판정 |
| 재계산 | FormulaTree 의존 그래프 기반 부분 재계산 |

## 6. 보안·안전

- 로컬 서버는 `127.0.0.1` 전용 바인딩, 세션 토큰으로 CSRF 차단
- 도면 파일은 절대 외부 전송 없음
- 원본 파일 열기는 **읽기 전용 핸들**. 저장은 항상 새 파일 경로
- `.scube`는 도면을 임베드하지 않고 경로+SHA-256 해시만 저장 → 도면 교체 감지
