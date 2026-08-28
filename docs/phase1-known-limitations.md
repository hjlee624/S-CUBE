# Phase 1 — 알려진 한계 (실도면 검증 전)

Phase 1 구현 시점에 확인된 한계 목록. 실도면 5종 검증(P1 검증 기준) 시 함께 점검한다.

## core (packages/core)

| 항목 | 내용 | 후속 |
|---|---|---|
| HATCH | dxf-parser 1.1.2에 HATCH 핸들러 없음 — 원문 사전 스캔으로 `unsupportedCounts['HATCH']` 집계만, NHatch 정규화 미구현. transform의 hatch 변환 로직은 선제 구현됨 | Phase 2 (자체 HATCH 경계 파서 또는 파서 교체) |
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
| 교차점 스냅 | 끝점/중점/중심만 지원 | Phase 2 (측정 정확도 직결) |
| 선종류 | 파선/1점쇄선 근사 미적용 — NEntity에 linetype 필드 없음 | schema 보강 후 |
| 치수 대조 단위 | 치수 텍스트 단위 == 도면 단위 가정. `verifiedBy` 누적 저장 미구현 | P1-12 보강 |
| header-units 자동 축척 | $INSUNITS 기반 자동 캘리브레이션 제안 미배선 (환산표·스키마는 존재) | UX 결정 후 연결 |
| 렌더 배칭 | 엔티티별 개별 stroke — 10만 엔티티 실측에서 미달 시 색상별 Path2D 배칭 | 실도면 성능 측정 후 |
| 캘리브레이션 저장 실패 | localStorage 실패 시 조용히 무시 (적용은 됨, 복원만 안 됨) | 경고 토스트 추가 |
