# 0002 — UI 스택: React 19 + Zustand + Tailwind CSS v4

- 상태: 채택
- 일자: 2026-08-28

## 맥락

02-ARCHITECTURE에서 React vs Solid, Tailwind 채택 여부가 Phase 0 확정 사항으로
보류되어 있었다. 도면·측정·측점·산출 상태가 서로 얽히는 복잡한 상태 관리와,
Canvas 렌더러와의 결합이 핵심 제약이다.

## 결정

- UI 프레임워크: **React 19**
- 상태 관리: **Zustand 5**
- 스타일: **Tailwind CSS v4** (`@tailwindcss/vite` 플러그인)

## 근거

- React: 생태계·레퍼런스 최다. 1인 개발에서 막혔을 때 풀 수 있는 자료의 양이
  Solid 대비 압도적. React 19 컴파일러로 리렌더 비용 우려도 완화.
- Zustand: 캔버스 렌더 루프가 store를 구독하되 React 렌더 사이클 밖에서
  `getState()`로 읽을 수 있다 — 팬/줌 60fps 경로에서 React를 우회 가능.
- Tailwind v4: 별도 CSS 파일 관리 없이 패널 UI를 빠르게 조판. Vite 플러그인으로
  설정 파일 없이 동작.

## 대안

- Solid: 성능 이점은 있으나 생태계·인력 리스크(R-12)가 더 큼 → 기각
- Redux: 보일러플레이트 과다, 캔버스 궁합 낮음 → 기각
- CSS Modules: 조판 속도 열세 → 기각

## 결과

`apps/web`은 React 19 + Zustand + Tailwind v4로 고정.
성능 미달 시 캔버스 경로만 최적화하고 UI 프레임워크는 재론하지 않는다.
