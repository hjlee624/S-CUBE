# S-CUBE — 개발 규약

## 1. 환경

| 항목 | 값 |
|---|---|
| Node.js | 24 LTS 이상 (개발 PC: v24.18.1) |
| 패키지 매니저 | pnpm (workspace) |
| 번들러 | Vite 8 (Rolldown 기본 내장 — `rolldown-vite` 별칭 금지) |
| Lint/Format | Biome 단독 (ESLint/Prettier 설치 금지) |
| 언어 | TypeScript strict |

## 2. 스크립트 규약

```jsonc
{
  "scripts": {
    "dev":    "pnpm -r --parallel dev",
    "build":  "pnpm -r build",
    "check":  "biome check --write . && tsc --build",
    "test":   "vitest run",
    "test:w": "vitest",
    "e2e":    "playwright test"
  }
}
```

커밋 전 반드시 `pnpm check && pnpm test` 통과.

## 3. 브랜치 · 커밋

- 기본 브랜치: `main`
- 작업 브랜치: `feat/<phase>-<slug>`, `fix/<slug>`, `docs/<slug>`
  - 예: `feat/p2-bulge-area`, `fix/station-pre-post-gap`
- 커밋 메시지: Conventional Commits
  ```
  feat(core): bulge 세그먼트 면적 보정 추가
  fix(station): 전/후 불연속 구간 체적 중복 계상 수정
  docs(plan): Phase 5 자동 폐합 리스크 보강
  ```
- Phase 완료 시 태그: `v0.<phase>.0`

## 4. 코드 규약

- **도메인 용어는 한국어 주석 병기**
  ```ts
  /** 양단면평균법 — V = (A1+A2)/2 × L */
  export function averageEndArea(a1: number, a2: number, length: number): number
  ```
- 변수·함수명은 영문. 단위를 이름에 명시: `length_m`, `area_m2`, `volume_m3`
- **단위 변환은 반드시 경계에서 1회만.** 내부는 항상 m 기준
- 숫자 반올림은 **표시 시점에만**. 계산 중간에 반올림 금지
- `any` 금지. 외부 데이터는 Zod로 파싱해서 타입 획득
- 계산 로직은 `packages/core`에만. UI 컴포넌트에 수식을 쓰지 않는다

## 5. 테스트 규약

- `packages/core`는 **커버리지 90% 이상**. 계산 오류가 곧 수량 오류다
- 기하 함수는 **해석해와 대조**하는 테스트를 반드시 포함
  (반원 bulge=1 면적, 정사각형 shoelace 등)
- 실도면 fixtures는 익명화 후 `fixtures/` 에 커밋 (프로젝트명·발주처 제거)
- 회귀 테스트: 기존 곡성·포천 산출 결과를 골든 파일로 고정

## 6. 문서 3계층

```
README.md            무엇을 하는 도구이고 어떻게 쓰나
docs/decisions/      왜 그렇게 만들었나 (ADR) — 되돌릴 수 없는 선택마다 1개
docs/experiments/    무엇을 시도해봤나 — 실패한 접근도 반드시 남긴다
PLAN/                단계별 계획 (본 폴더)
```

ADR 파일명: `NNNN-<slug>.md` (예: `0003-use-canvas2d-over-webgl.md`)
형식: 맥락 / 결정 / 근거 / 대안 / 결과

## 7. 데이터 안전

- 원본 DWG/DXF는 **절대 수정하지 않는다**. 읽기 전용 핸들만 사용
- 저장은 항상 새 파일 경로. 덮어쓰기는 명시적 확인 후
- 실도면·실프로젝트 파일은 저장소에 커밋 금지 (`.gitignore`)
- 로컬 서버는 `127.0.0.1` 전용 바인딩

## 8. 저장소

- GitHub: `hjlee624/S-CUBE`
- 커밋 계정: `hjlee624 <lordrumer0624@gmail.com>`
