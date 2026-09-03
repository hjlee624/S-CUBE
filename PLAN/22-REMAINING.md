# S-CUBE — 남은작업 로드맵 (반자동 완결 관점)

> Phase 0~4(MVP)는 완료. 이 문서는 **"사람은 클릭·판단만, 도구가 나머지 전부"** 라는
> 반자동 의도를 완결하는 관점에서 남은 작업의 **우선순위**를 정리한다.
> 우선순위 기준: (a) 도면 유래 수치의 수기입력을 실제로 0에 수렴시키는가,
> (b) 대표 워크플로 클릭 수를 줄이는가, (c) 감리 검증/역추적을 확보하는가.

## 완료 상태 요약

| 영역 | 상태 |
|---|---|
| DXF/DWG 로드·렌더·캘리브레이션 (Phase 0~1) | ✅ |
| 면적·연장 측정, 역추적 (Phase 2) | ✅ (HATCH 면적·교차점 스냅 잔여) |
| 측점·양단면평균법 체적 (Phase 3) | ✅ (측점 번호만 입력 반영) |
| 규격 마스터·산출항목·엑셀 수식 산출서 (Phase 4) | ✅ (MVP) |
| BOQ 8종·프리셋 74·다중도면·PiP·모션 | ✅ (추가 반영) |
| 원지반·계획선 2클릭 절토/성토 (FR-3.10) | ⏳ 배선 완료, 마무리·검증 중 |

## 우선순위 로드맵

### P0 — 반자동 핵심 완결 ✅ 완료 (RW-1~3) / RW-4 진행 중

- [x] **RW-1** FR-3.10 2클릭 절토/성토 마무리 (P3-16) — `b36ff9d`
  - `ui-slice.ts` setActiveStationId, StationTable 행선택 → activeStationId 전환 완료
- [x] **RW-2** HATCH 경계 파서 (P2-8) — `20ee492`
  - `parse-hatch.ts`: 그룹코드 91/92/93/72/73 loop 파싱, even-odd island 차감
  - `pipeline.ts`: parseHatchEntities 통합, failedCount→unsupportedCounts.HATCH 반영
- [x] **RW-3** 교차점 스냅 (P1-10/P2-15) — `20ee492`
  - `snap.ts` SnapKind='intersection', rank(1), `intersection.ts` line/arc 교점
  - 우선순위: endpoint > intersection > midpoint > center
- [ ] **RW-4** 제목 TEXT 측점 자동 인식 (P3-5) — 2클릭+측점 자동의 마지막 고리
  - 프레임 근접 TEXT → `parseStation` → 활성 측점 자동 배정(사용자 확인식), 실패 시 번호만 폴백

### P1 — 파생 수량 반자동 + 검증 게이트 ✅ 완료 (wave2)
옹벽 1기에서 콘크리트만 넣으면 거푸집·비계·동바리가 자동 전개되게 한다.

- [x] **RW-5** 단면 파생 취득 (P4-9-1, FR-4.9) — `922ea80`
  - `derived-contact/scaffold/shore` + `DerivedSource` + `buildDerivedNode`
- [x] **RW-6** area-thickness 두께 규격 연동 (P4-3) — `922ea80`
  - `MaterialSpec.thickness_m` 연동, 두께 없는 규격 null 반환
- [x] **RW-7** 계산유형 정합·가시화 (P4-9-2, FR-4.8) — `922ea80`
  - `CalcType` 유니온, `CALC_TYPE_OF`, `resolveCalcType`
- [x] **RW-8** 내보내기 직전 통합 검증 게이트 (P4-14 / P6-1 전진) — `c244ba0`
  - unsupported-entities/sanitized-coords 경고 + xlsx 검증 리포트 시트(6번째)
- [x] **RW-9** 감사 로그 최소 기록 (FR-7.3 필수 승격) — `c244ba0`
  - `history` 슬라이스 배선, measurement/section/item 추가·삭제 자동 기록

### P2 — 객체 기반 일괄·자동 폐합 (클릭 수 대폭 절감)
레이어에 의존하지 않는 축으로 일괄화한다.

- [ ] **RW-10** 프로토타입 선행 — `docs/experiments/`에 face 탐색 vs flood-fill 타당성 검증
- [ ] **RW-11** 자동 폐합 탐색 (P5-1 + P5-3) — tolerance snap 선분그래프, 최소 폐합 face
- [ ] **RW-12** 객체 기반 후보 그룹핑 (P5-7c/7d) — 기하·색상·선형 유사도 군집→사용자 승인,
  다수 단면 제목/프레임 인식→원지반/계획선 쌍 일괄 후보
- [x] **RW-13** 블록/심볼 자동 카운트 (P5-17/18) — count 유형 자동화(배수·앵커·다웰),
  카운트 handle 목록 역추적
- [ ] **RW-14** 레이어 규칙 (P5-7~10) — **옵션 가속**으로 후순위(R-9)

### P3 — 강건성·회귀·배포
- [x] **RW-15** ELLIPSE/SPLINE 집계·근사 (R-14) — `20ee492`
  - `normalize.ts` normalizeEllipse/normalizeSpline 폴리라인 근사 추가
- [x] **RW-16** 변환 INSERT 손실 감지 (R-13) — `0a6df65`
  - DWG 변환 후 고아 블록(INSERT 수 불일치) 감지·경고
- [x] **RW-17** bounds 오염 대응 (R-15) — `65ba3e5`
  - `outlier.ts` 상대 이상치 검출, 제외 근거 보존
- [x] **RW-18** DWG 직접 입력 완성 (P5-11~14) — `3760ec3`
  - LibreDWG 1순위, ODA 폴백 이원화 완성
- [ ] **RW-19** 반자동 계측 E2E/벤치마크 (P6-6/7, NFR-8/9)
  - Playwright 스모크 1건 CI 연결 + 클릭 수·수기입력 횟수 계측(회귀 지표)
- [ ] **RW-20** 실도면 fixtures 익명화 파이프라인 (P6-5) — CAD/·Quantity_sample/ 활용
- [x] **RW-21** 검증 리포트 정식화·diff·배포 (P6-1~13) — `c244ba0`
  - xlsx 검증 리포트 시트(6번째), 항목·역추적·집계 포함 (RW-8에서 구현)

## 반자동 성공기준 (완결 판정)

- 표준횡단 1측점 절토/성토 산출 **≤4클릭**, 도면 유래 수치 **수기입력 0회** (NFR-8/9)
- 옹벽 1기 콘크리트 입력 → 거푸집·비계·동바리 자동 전개 + 역추적
- 실도면 열린 선분 횡단면 20개 중 17개 이상 클릭 위주 산출(2클릭 또는 자동폐합)
- 모든 수량 셀 역추적 가능 수식 + 내보내기 직전 검증 게이트 통과

## 원칙 재확인
- 도면상 수치는 **읽어 옮기지 않는다** — 기하/좌표에서 산출, 텍스트는 검증·경고용 (원칙 2)
- 분류·일괄화는 **객체 속성 1순위**, 레이어는 보조 가속 (원칙 3)
- 수기 입력은 **도면 외 수량(FR-4.7)** 으로만 한정 (NFR-8)
