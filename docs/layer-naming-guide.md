# S-CUBE 레이어 명명 규칙 권고안 (P5-10)

> **주의**: 레이어 규칙은 **보조 가속 수단**이다. 이 문서의 규칙을 따르지 않아도
> S-CUBE의 모든 기능(객체 기반 경로)은 정상 동작한다.

## 배경

실무 토목 도면은 작성자·회사·프로젝트마다 레이어 명명 규칙이 제각각이다.
S-CUBE는 레이어 규칙에 의존하지 않고 **기하·색상·위상 기반**으로 수량을 산출한다.

그러나 사무소 내부 표준이 있는 경우, `LayerRule` 설정을 통해 레이어명 패턴 →
항목 유형 자동 매핑으로 클릭 수를 추가로 줄일 수 있다.

---

## 권고 레이어 명명 패턴

### 기본 원칙

| 원칙 | 내용 |
|------|------|
| 영문 대문자 | 파서 대소문자 무시이나, 표준화로 가독성 확보 |
| 하이픈(`-`) 구분 | 카테고리-세부항목 형식 (예: `CUT-AREA`) |
| 와일드카드 활용 | `CUT-*`로 여러 절토 레이어를 한 규칙으로 포함 가능 |
| 공백 사용 금지 | 일부 DXF 파서가 공백 레이어명을 처리 못함 |

---

### 절토·성토 (토공 횡단)

| 레이어명 | 설명 | 권장 CalcType |
|----------|------|--------------|
| `CUT-AREA` | 절토 단면적 경계 | `area` |
| `FILL-AREA` | 성토 단면적 경계 | `area` |
| `CUT-*` | 절토 관련 모든 레이어 | `area` |
| `FILL-*` | 성토 관련 모든 레이어 | `area` |
| `GROUND` | 원지반선 | `area` (프로파일) |
| `DESIGN` | 계획고선 | `area` (프로파일) |

### 구조물 (콘크리트·거푸집)

| 레이어명 | 설명 | 권장 CalcType |
|----------|------|--------------|
| `CONC-*` | 콘크리트 경계 | `area-thickness` |
| `FORM-*` | 거푸집 경계 | `contact-length` |
| `SCAFFOLD-*` | 비계 | `contact-length` |

### 선형 (도로·수로)

| 레이어명 | 설명 | 권장 CalcType |
|----------|------|--------------|
| `ROAD-*` | 도로 선형 | `length` |
| `DRAIN-*` | 배수로 | `length` |
| `CENTER` | 중심선 | `length` |

### 블록/심볼 카운트

| 레이어명 | 설명 | 권장 CalcType |
|----------|------|--------------|
| `ANCHOR-*` | 앵커 심볼 | `count` |
| `DOWEL-*` | 다웰 심볼 | `count` |
| `DRAIN-PIPE` | 배수관 심볼 | `count` |

---

## LayerRule 예시 (.scube 프로젝트 설정)

```json
"layerRules": [
  {
    "id": "rule-cut",
    "pattern": "CUT-*",
    "calcType": "area",
    "label": "절토"
  },
  {
    "id": "rule-fill",
    "pattern": "FILL-*",
    "calcType": "area",
    "label": "성토"
  },
  {
    "id": "rule-conc",
    "pattern": "CONC-*",
    "calcType": "area-thickness",
    "specCode": "C-210",
    "label": "콘크리트"
  },
  {
    "id": "rule-anchor",
    "pattern": "ANCHOR-*",
    "calcType": "count",
    "label": "앵커"
  }
]
```

---

## 사용 흐름 (P5-7~9)

```
1. 도면 로드
2. 레이어 규칙 적용 → matchLayerRules(entities, layerRules) 호출
3. buildRuleCandidates(matches) → 항목 후보 목록 생성
4. 사용자가 후보 승인/거부 (자동 확정 금지)
5. 승인된 항목 → TakeoffItem 추가
```

> 규칙이 없으면 2~4단계가 건너뛰어지고 객체 기반 경로(groupBySimilarity)만 동작한다.

---

## 레이어 규칙 없이도 동작하는 이유

S-CUBE는 `groupBySimilarity(entities)` + `detectSectionPairs(groups)` 로
레이어 이름 없이도 기하·색상·오버랩 기반으로 원지반/계획선 쌍을 탐색한다.
레이어 규칙은 이 과정을 **가속**하는 추가 힌트일 뿐이다.
