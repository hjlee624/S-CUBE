# Phase 2 — 면적 · 연장 측정

**목표**: 도면에서 클릭 한 번으로 단면적과 연장이 나온다. 값에는 출처가 붙는다.

## 작업 항목

### 2-A. 기하 연산 (`packages/core/src/geometry/`)
- [ ] **P2-1** shoelace 면적 (부호 포함 → 방향 판정에 사용)
- [ ] **P2-2** bulge 세그먼트 면적 보정
  - bulge → 원호 파라미터 변환: `θ = 4·atan(bulge)`, `R = c / (2·sin(θ/2))`
  - 활꼴(circular segment) 면적을 가감
  - **단위 테스트 필수**: 반원 bulge=1, 사분원 bulge=tan(π/8) 해석해와 대조
- [ ] **P2-3** 다각형 점 포함 판정 (ray casting, 경계 tolerance 처리)
- [ ] **P2-4** 내부 구멍(island) 차감 — even-odd 규칙
- [ ] **P2-5** 폴리라인 길이 (직선 + 원호 호장)

### 2-B. 선택 UI
- [ ] **P2-6** 히트테스트 — R-tree 후보 → 정밀 판정
  - 선: 점-선분 거리 ≤ pick tolerance(px 기준, 줌 무관)
  - 폐합 영역: 내부 클릭 시 선택
- [ ] **P2-7** 단일/다중 선택 (Shift 추가, Ctrl 해제), 선택 하이라이트
- [ ] **P2-8** HATCH 클릭 → 경계 루프에서 면적 산출 — **미구현(우선순위 상향)**
  - 현재 상태: `SUPPORTED_ENTITY_TYPES`에 HATCH 없음. 원문 스캔으로 `unsupportedCounts.HATCH`
    개수만 집계·드롭 → 실도면 절/성토·포장·시트류 면적 **대부분이 HATCH**라 치명적 공백
  - (a) DXF HATCH 경계 그룹코드 **91/92/93/72/73 loop 직접 파싱** — polyline 경계 우선,
    edge line/arc 지원, spline 경계는 근사+경고(R-6 방침)
  - (b) `normalize.ts` SUPPORTED에 HATCH 추가 + `NHatch(loops)` 정규화, `pick.ts` 내부
    히트테스트, `area.ts` even-odd island 차감
  - (c) **폴백**: 파서 완성 전까지 seed/boundary 참조 경계 폴리라인 자동선택 우회경로
  - (d) `unsupportedCounts.HATCH > 0`이면 UI가 "HATCH N개 면적 산출 불가" **경고**
    (현재 조용히 누락 — P1-2 정신 위반)
  - 검증기준: **HATCH 면적 = 경계 폴리라인 면적** (오차 1e-6)
- [ ] **P2-9** DIMENSION 클릭 → `measured_m` 사용, override 텍스트 있으면 경고 배지
- [ ] **P2-10** 측정 결과 패널 — 값, 단위, 출처(레이어·handle), 명명(label) 입력
- [ ] **P2-11** 측정 항목 클릭 시 도면 해당 객체로 **줌 + 하이라이트** (역추적)

### 2-C. 신뢰성
- [ ] **P2-12** 열린 폴리라인 감지 → "폐합되지 않음" 경고 + 강제 폐합 옵션
  (시점-종점 직선 연결, 오차 거리 표시)
- [ ] **P2-13** 면적 0 / 자기교차 폴리라인 감지 및 경고
- [ ] **P2-14** 측정값 소수점 자리수 정책 (면적 4자리, 연장 3자리, 표시만 반올림 —
  내부 계산은 full precision 유지)

### 2-D. 교차점 스냅 보강 (P1-10 필수 항목의 이월)
- [ ] **P2-15** 교차점(intersection) 스냅 — 현재 `SnapKind`에 endpoint/midpoint/center만
  존재(미구현). 원지반·계획선 **교차점은 절토/성토 경계이자 캘리브레이션 기준점**이라
  FR-3.10 2클릭 산정 정확도에 직결됨 → 우선순위 상향
  - `apps/web/src/canvas/snap.ts` `SnapKind`에 `'intersection'` 추가
  - 커서 주변 세그먼트 쌍(line-line / line-arc / arc-arc) 교점 계산, bulge는
    `primitives.ts` bulgeToArc 활용, R-tree로 후보 제한
  - 스냅 우선순위: **endpoint > intersection > midpoint > center**

## 검증 기준
- CAD `AREA` 명령 결과와 S-CUBE 면적 **상대오차 1e-6 이내** (bulge 포함 도형)
- 실도면 횡단면 20개 측정 결과가 기존 엑셀 값과 일치
- 측정 항목 → 원본 객체 역추적 100% 동작
- HATCH 클릭 면적 = 경계 폴리라인 면적 (오차 1e-6), 미지원 HATCH 존재 시 UI 경고 노출
- 교차점 스냅이 line/arc 조합에서 정확히 동작

## 판단 포인트
- 이 단계의 면적 취득은 **폐합된 폴리라인 + HATCH**를 지원한다.
  실무 도면의 절반 이상은 열린 선분 조합인데, 이 경우 **① 원지반·계획선 2클릭 프로파일
  산정(FR-3.10, Phase 3 P3-16)** 과 **② 자동 폐합 탐색(Phase 5)** 이 커버한다.
  Phase 2 목표는 "계산 엔진이 정확한가"를 먼저 증명하는 것.
