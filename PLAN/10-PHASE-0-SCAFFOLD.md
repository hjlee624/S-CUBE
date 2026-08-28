# Phase 0 — 스캐폴딩 · 툴체인

**목표**: `pnpm install && pnpm dev` 하면 빈 앱이 뜨고, `pnpm check`가 통과하는 모노레포.

## 작업 항목

- [ ] **P0-1** pnpm workspace 구성
  - `pnpm-workspace.yaml`: `apps/*`, `packages/*`
  - 루트 `package.json` — `packageManager` 필드로 pnpm 버전 고정
  - `.npmrc`: `engine-strict=true`, `node-linker=isolated`
- [ ] **P0-2** Node 24 고정
  - `package.json` `engines.node: ">=24.0.0"`
  - `.nvmrc` / `.node-version`
- [ ] **P0-3** TypeScript 베이스 설정
  - `tsconfig.base.json` — `strict: true`, `noUncheckedIndexedAccess: true`,
    `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`
  - 패키지별 `tsconfig.json` 은 project references로 연결
- [ ] **P0-4** Biome 설정
  - `biome.json` — formatter + linter 동시 사용, ESLint/Prettier 미설치
  - 규칙: `noExplicitAny` error, `useExhaustiveDependencies` warn
  - 스크립트: `pnpm check` = `biome check --write` + `tsc --build`
- [ ] **P0-5** `apps/web` — Vite 8 + React 19 + TS
  - `vite.config.ts` — Rolldown 기본 사용 확인 (별도 `rolldown-vite` 불필요)
  - Tailwind v4 (Vite 플러그인 방식)
  - 빈 3분할 레이아웃 셸: 좌 도구패널 / 중앙 캔버스 / 우 속성패널
- [ ] **P0-6** `apps/server` — Hono + Node 24
  - `127.0.0.1` 바인딩, 포트 5321
  - `/api/health` 만 우선
- [ ] **P0-7** `packages/core`, `packages/schema`, `packages/xlsx` 빈 패키지 생성
- [ ] **P0-8** Vitest 설정 + 더미 테스트 1개
- [ ] **P0-9** GitHub 저장소 연결 및 CI
  - `.github/workflows/ci.yml` — Node 24 matrix, `pnpm check` + `pnpm test`
- [ ] **P0-10** 문서 3계층 골격
  - `README.md`, `docs/decisions/0001-record-architecture-decisions.md`,
    `docs/experiments/README.md`
- [ ] **P0-11** `.gitignore` — `node_modules`, `dist`, `.scube-cache`, 실도면(`*.dwg`, `*.dxf` 단 `fixtures/` 예외)

## 검증 기준
- `pnpm install` 무경고 완료
- `pnpm dev` 로 웹 + 서버 동시 기동 (concurrently 또는 `--filter` 병렬)
- `pnpm build` 성공, Rolldown 빌드 로그 확인
- `pnpm check` 무오류
- CI 그린

## 주의
- **Vite 8은 Rolldown이 기본**이므로 `rolldown-vite` 별칭을 넣지 말 것.
  넣으면 중복 번들러 경고가 난다.
- Biome 도입 시 IDE 확장(VS Code Biome) 설정을 `.vscode/settings.json`에 커밋해
  팀원 간 포맷 차이를 없앤다.
