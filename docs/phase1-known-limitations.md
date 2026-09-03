# Phase 1 — 알려진 한계 (실도면 검증 전)

Phase 1 구현 시점에 확인된 한계 목록. 실도면 5종 검증(P1 검증 기준) 시 함께 점검한다.

## core (packages/core)

| 항목 | 내용 | 후속 |
|---|---|---|
| HATCH | dxf-parser 1.1.2에 HATCH 핸들러 없음 — 원문 사전 스캔으로 `unsupportedCounts['HATCH']` 집계만, NHatch 정규화 미구현. transform의 hatch 변환 로직은 선제 구현됨 | **작업 승격**: 실도면 절/성토·포장·시트류 면적 대부분이 HATCH → '알려진 한계'가 아닌 **명시 작업**. Phase 2 P2-8: 그룹코드 91/92/93/72/73 loop 직접 파싱 + `unsupportedCounts.HATCH>0` UI 경고 |
| ELLIPSE/SPLINE | `PARSER_KNOWN_MARKERS`에 포함되어 `unsupportedCounts` 집계에서조차 제외됨 — **P1-2(미지원 개수 집계) 위반** | **작업 승격(R-14)**: `scan-unsupported.ts`에서 제거하거나 'parsed-but-not-normalized' 별도 집계로 분리해 UI 노출. normalize 폴리라인 근사 검토 |
| 변환 INSERT 손실 | LibreDWG가 복잡 DWG 설계 배치 INSERT/블록참조를 잃어 렌더·산출 누락 관측 | **R-13**: 변환 후 INSERT 수 원본 대조 경고, ODA 폴백·CAD 직접 DXF 저장 가이드. [실험 기록](./experiments/20260828-libredwg-real-dwg.md) 후속 |
| 비균등 스케일 INSERT | ARC/CIRCLE/bulge → 폴리라인 근사 폴백 (128분할, 오차 ≈ r×3e-4). kind가 polyline으로 변경됨 | 허용 오차 검토 |
| handle 중복 | 블록 다중 INSERT 시 원본 handle 유지 → 인스턴스 간 중복. `origin.blockPath/transform`으로 구분 | Phase 2 역추적 설계 시 반영 |
| 비균등 스케일 내 DIMENSION | `measuredRaw`에 √\|det\| 근사 (최대 √2 오차 가능) | 수량 산출 전 defPoints 재계산 검토 |
| BYBLOCK/layer '0' 상속 | 블록 내 layer '0' 엔티티의 INSERT 레이어 상속, colorIndex 0 해석 미구현 | 실도면 렌더 확인 후 |
| TEXT bounds | 폰트 메트릭 없어 삽입점만 포함 | 렌더 컬링에 영향 미미 |
| 미지원 집계 | ASCII 2줄 고정 보폭 스캔 — 비정형 파일에서 어긋날 수 있음. 바이너리 DXF 미지원 | 카운트 교차 검증 테스트 추가 |

## web (apps/web)

| 항목 | 내용 | 후속 |
|---|---|---|
| Zoom Window | 미구현 (선택 항목). Zoom Extents + 커서 앵커 줌 제공 | 필요 시 |
| 교차점 스냅 | 끝점/중점/중심만 지원 (`SnapKind`에 intersection 없음) | **작업 대상(P1-10 필수 유지, P2-15)**: 원지반·계획선 교차점은 절토/성토 경계이자 캘리브레이션 기준점 → FR-3.10 2클릭 정확도 직결로 우선순위 상향. line/arc 조합 교점 계산, 우선순위 endpoint>intersection>midpoint>center |
| bounds 오염 | 측량 대좌표+쓰레기 좌표로 bounds 왜곡 관측 | **R-15**: `outlier.ts` 상대 이상치 검출, 제외 근거 보존 |
| 선종류 | 파선/1점쇄선 근사 미적용 — NEntity에 linetype 필드 없음 | schema 보강 후 |
| 치수 대조 단위 | 치수 텍스트 단위 == 도면 단위 가정. `verifiedBy` 누적 저장 미구현 | P1-12 보강 |
| header-units 자동 축척 | $INSUNITS 기반 자동 캘리브레이션 제안 미배선 (환산표·스키마는 존재) | UX 결정 후 연결 |
| 렌더 배칭 | 엔티티별 개별 stroke — 10만 엔티티 실측에서 미달 시 색상별 Path2D 배칭 | 실도면 성능 측정 후 |
| 캘리브레이션 저장 실패 | localStorage 실패 시 조용히 무시 (적용은 됨, 복원만 안 됨) | 경고 토스트 추가 |
