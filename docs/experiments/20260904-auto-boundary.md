# 자동 폐합 탐색 — face 탐색 vs flood-fill 타당성 검증 (RW-10)

## 목표

실도면(토목 횡단면도)에서 열린 선분들을 자동으로 폐합해 면적 산출 가능한 폐합 폴리라인을 만든다.
사용자가 클릭 없이 또는 최소 클릭으로 절토/성토 단면적을 얻는 것이 목표(NFR-8/9 ≤4클릭).

## 두 가지 접근 비교

### A. 위상 그래프(Planar Graph) + 최소 면(Minimum Face) 탐색

**방법:**
1. 선분 끝점들을 snap tolerance로 병합해 위상 노드를 만든다(Union-Find).
2. 노드-간선 그래프를 구성한다.
3. 각 노드에서 DFS로 최소 순환(cycle)을 탐색한다.
4. 면적 > 0 인 순환만 폐합 후보로 반환한다.

**장점:**
- 정확한 위상 구조를 만든다.
- 복잡한 다중 연결 단면도에서도 개별 구간(e.g., 절토 vs 성토)을 분리 탐색 가능.
- 핸들 역추적이 정확(어느 선분이 경계를 이루는지 알 수 있음).

**단점:**
- snap tolerance 선택이 어렵다(너무 작으면 연결 안 됨, 너무 크면 틀린 연결).
- 복잡한 교차 구조에서 O(V·E) 이상.
- DCEL(Doubly Connected Edge List) 구현이 필요하면 더 복잡해짐.

**적합 시나리오:** 표준 횡단면도(사람이 그린 선 위주), 선분 수 < 500.

### B. 래스터 Flood-fill

**방법:**
1. 선분들을 래스터 이미지로 렌더링한다.
2. 빈 픽셀에서 flood-fill로 연결된 영역을 찾는다.
3. 영역을 역투영해 폴리라인으로 근사한다.

**장점:**
- 열린 선분 간격이 작으면 자동으로 연결.
- 구현이 단순(BFS 기반).

**단점:**
- 해상도에 따라 정밀도 손실.
- 역투영 시 노이즈/계단 현상.
- 핸들 역추적이 불가능(픽셀은 원본 엔티티를 모름).
- 실도면의 넓은 좌표 범위(수천 m)에서 비현실적.

**적합 시나리오:** 단순 스캔 이미지, 핸들 역추적 불필요.

## 결론 및 채택 결정

**위상 그래프 방식(A)**을 채택한다.

이유:
1. S-CUBE의 핵심 요구는 "역추적" — 어떤 선분이 경계인지 알아야 감리 검증 가능.
2. 실도면은 벡터 DXF이므로 래스터 손실 없이 정확한 위상을 구성할 수 있다.
3. snap tolerance는 캘리브레이션 기반으로 도면 단위를 알 수 있어 합리적 기본값 설정 가능.

## 구현 결과 (RW-11)

`packages/core/src/geometry/auto-close.ts`에 구현:
- `buildSnapGraph(entities, snapTolerance)` — Union-Find 기반 endpoint snap
- `findClosedFaces(graph)` — DFS 기반 최소 순환 탐색, 면적 > 0 필터
- `autoCloseEntities(entities, snapTolerance)` — 통합 API

테스트: `packages/core/src/geometry/auto-close.test.ts`

## 한계 및 향후

- 현재 선분(LINE)·폴리라인(POLYLINE/LWPOLYLINE) 만 지원. 호(ARC)는 선분 근사.
- snap tolerance 자동 추정(도면 단위 기반): `maxEndpointGap = 캘리브레이션 해상도 × 2` 권장.
- 다중 외곽(disjoint faces) 분리는 even-odd 깊이로 처리(parse-hatch와 동일 접근).
