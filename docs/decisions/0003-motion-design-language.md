# 0003 — 모션 디자인 언어: CSS 토큰 기반 마이크로 모션 시스템

- 상태: 채택
- 일자: 2026-08-28

## 맥락

S-CUBE는 다크 zinc + emerald 톤의 CAD 웹앱이나, 기본 마이크로 모션(fade-in-up,
토스트 등장, 진행바)만 있어 첫인상이 정적이었다. Daylight·RedSun·Aside·
Cartesia·customer.io·Krepling 등 레퍼런스의 동적 UI 감도를 도구 전문성을
해치지 않는 선에서 이식해야 한다. 캔버스 렌더 루프(renderer.ts)의 60fps
성능 경로는 절대 건드리지 않는다.

## 결정

**라이브러리 추가 없이 Tailwind v4 `@theme` 토큰 + 순수 CSS 키프레임**으로
모션 시스템을 구축한다. `motion`(framer-motion 후속)은 현 시점 시퀀스 복잡도가
CSS로 충분히 커버되어 도입하지 않는다(번들 0KB 증가).

### 이징 토큰 (레퍼런스 → 번역표)

| 토큰 | 값 | 출처 | 용도 |
| --- | --- | --- | --- |
| `--ease-out-expo` | cubic-bezier(0.19, 1, 0.22, 1) | Krepling 대형 리빌 / customer.io ease-out-fast | 패널·히어로 진입 |
| `--ease-out-quint` | cubic-bezier(0.22, 1, 0.36, 1) | Cartesia 진입 이징 | 행 슬라이드-인, 라벨 스왑, 틱 |
| `--ease-back` | cubic-bezier(0.175, 0.885, 0.32, 1.275) | RedSun 시그니처 오버슛 | 토스트·모달·배너·아이콘 팝 |
| `--ease-in-expo` | cubic-bezier(0.7, 0, 0.84, 0) | Cartesia 퇴장 이징 | 히어로 exit |

### 지속시간 스케일 (2단 속도 체계 — Krepling 규칙)

- **마이크로** 120–200ms: hover 색·2px 이동·active scale — 반복 클릭에 피로 없게
- **전환** 250–450ms: 토스트/모달/배너 등장, 라벨 스왑, 틱
- **리빌** 500–900ms: 앱 셸 패널 스태거, 히어로 문자 리빌, 성공 펄스
- **장식 루프** 2–12s linear: thinking 시머(2s), shine 스윕(3.6s), 그라디언트 드리프트(12s) — 배경/가장자리 전용(Daylight 규칙: 콘텐츠 위 금지)

### 색·글로우 토큰

- 서페이스 4단: `--color-surface-0..3` (zinc-950→800 다크 램프, Daylight 베이지 4단의 다크 번역)
- 단일 액센트 절제: emerald-500/400만 액션·활성·성공에 사용
- 발광 유리 3종 세트(RedSun 번역): `--glow-border`(emerald 16% 보더),
  `--glow-inset`(inset 0 -9px 24px emerald 10%), `--glow-halo`(0 0 0 4px 헤일로,
  customer.io CTA flare) → `.glow-card` 유틸리티
- `.dot-grid`: 22px 간격 1px 도트(customer.io) — 엔트리 화면 배경, CAD 모눈 은유

### 적용 안무 (구현 인벤토리)

- 엔트리 히어로: 문자 스태거 리빌(char-rise 0.7s expo-out, 55ms 증분) + conic
  그라디언트 드리프트 배경 + shine CTA. 도면 로드 시 hero-exit(0.4s in-expo,
  blur+scale)로 퇴장 후 언마운트
- 앱 셸: 헤더(top)→레이어 패널(left, 80ms)→우측 패널(right, 140ms)→상태바
  (bottom, 180ms) 방향별 스태거 진입
- 상태 표현: 파싱 진행바 thinking 시머(Aside), 단계 라벨 blur-in 스왑
  (grid-area 1/1 겹침 — customer.io 회전 단어의 레이아웃 점프 방지 기법)
- 데이터 등장: 레이어 행·치수 대조 행 row-in(translateX 20px→0, Cartesia
  transcription 슬라이드-인 축소판) + 35–60ms 스태거
- 마이크로: 도구 버튼 tool-pop(back-out), 눈 아이콘 eye-pop, 상태바 값 tick,
  레이어 스와치 hover 글로우(레이어 색 `--swatch-color` + color-mix)
- 캔버스 피드백: 캘리브레이션 확정 시 화면 가장자리 emerald success-pulse —
  **DOM/CSS 오버레이로만 구현, renderer.ts 미접촉**

## 접근성

`prefers-reduced-motion: reduce` 시 전 애니메이션·트랜지션을 0.01ms로 강제해
즉시 완료 상태로 렌더한다(`both` fill이라 최종 상태 보장, 무한 루프는
iteration-count 1로 정지). index.css 최하단 미디어쿼리로 전역 적용.

## 대안

- `motion` 라이브러리: exit 안무·스프링 물리는 매력적이나 현 요구는 CSS로 충분.
  Phase 2 수량산출 결과 시퀀스가 복잡해지면 LazyMotion으로 재검토
- JS IntersectionObserver 기반 리빌: 단일 화면 도구라 스크롤 내러티브 불필요 → 기각

## 결과

번들 크기 불변. 모든 모션은 transform/opacity/filter(GPU 합성)만 사용하고
레이아웃 속성 애니메이션은 진행바 width 하나(기존 유지)뿐이다. 신규 모션은
캔버스 RAF 루프와 완전히 분리된 DOM 레이어에서만 동작한다.
