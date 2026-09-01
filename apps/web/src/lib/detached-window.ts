/**
 * 별도 창(분리 작업대) 순수 로직 — DOM 비의존 부분만 여기 모아 단위테스트한다.
 *
 * Document Picture-in-Picture API(https://developer.mozilla.org/docs/Web/API/Document_Picture-in-Picture_API)
 * 로 수량산출 작업대를 OS 창으로 분리한다. requestWindow 호출·portal 마운트 같은 DOM 조작은
 * hooks/useDetachedWindow.ts 가 담당하고, 여기서는 (1) 지원 여부 판별 (2) 열기 전략 선택
 * (3) 스타일시트 복제 전략 결정 (4) 재도킹 상태 전이 를 순수 함수로 둔다.
 *
 * lib.dom 최신에도 documentPictureInPicture 타입이 없을 수 있어(2026-01 기준) 좁은 인터페이스를
 * 로컬 선언한다(any 금지). 실제 브라우저 객체는 이 형태의 부분집합이면 동작한다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 최소 타입 선언 (lib.dom 미포함분) — 좁은 인터페이스, any 없음
// ─────────────────────────────────────────────────────────────────────────────

/** Document PiP 창 — pip.window 은 표준 Window(우리가 쓰는 부분만) */
export interface DocumentPipWindow {
  readonly window: Window;
}

/** navigator/window 에 붙는 documentPictureInPicture 진입점 (표준 초안) */
export interface DocumentPipApi {
  readonly window: Window | null;
  requestWindow(options?: { width?: number; height?: number }): Promise<DocumentPipWindow>;
}

/** documentPictureInPicture 를 노출할 수 있는 전역(Window) — 옵셔널 확장 */
export interface PipCapableWindow {
  documentPictureInPicture?: DocumentPipApi;
  open(url?: string, target?: string, features?: string): Window | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 지원 여부·열기 전략
// ─────────────────────────────────────────────────────────────────────────────

/** 어떤 방식으로 별도 창을 열지 */
export type OpenStrategy = 'document-pip' | 'popup';

/**
 * Document PiP API 지원 여부. 미지원이면 window.open 폴백을 쓴다.
 * requestWindow 함수 존재까지 확인해 부분구현(속성만 있고 메서드 없음)도 걸러낸다.
 */
export function supportsDocumentPip(win: PipCapableWindow | undefined | null): boolean {
  if (win == null) return false;
  const api = win.documentPictureInPicture;
  return api != null && typeof api.requestWindow === 'function';
}

/** 별도 창을 열 수 있는 환경인지 (PiP 또는 popup — 사실상 브라우저면 항상 true) */
export function canDetach(win: PipCapableWindow | undefined | null): boolean {
  if (win == null) return false;
  return supportsDocumentPip(win) || typeof win.open === 'function';
}

/** 지원 여부에 따라 열기 전략 선택 */
export function pickOpenStrategy(win: PipCapableWindow | undefined | null): OpenStrategy {
  return supportsDocumentPip(win) ? 'document-pip' : 'popup';
}

/** window.open 폴백용 features 문자열 조립 (width/height) */
export function popupFeatures(width: number, height: number): string {
  return `popup=yes,width=${Math.round(width)},height=${Math.round(height)}`;
}

/** window.open 반환값으로 팝업 차단 여부 판정 (null 이면 차단) */
export function isPopupBlocked(popup: Window | null): boolean {
  return popup == null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스타일 복제 전략 — 어떤 노드를 복제하고 어떤 시트를 adopt 할지 계획만 순수 계산
// ─────────────────────────────────────────────────────────────────────────────

/** 스타일 복제 계획의 한 항목 */
export type StyleCloneStep =
  /** 동일 출처 시트 → cssRules 를 새 CSSStyleSheet 로 복제해 adoptedStyleSheets 에 추가 */
  | { readonly mode: 'adopt'; readonly index: number }
  /** cross-origin 등 규칙 접근 실패 → 원본 owner 노드(<link>/<style>)를 cloneNode 로 복제 */
  | { readonly mode: 'clone-node'; readonly index: number };

/**
 * styleSheets 목록을 순회해 각 시트를 adopt(규칙 복제) 할지 clone-node(원본 노드 복제) 할지 결정.
 *
 * canReadRules(i): 해당 인덱스 시트의 cssRules 를 읽을 수 있는가(동일 출처). cross-origin
 * 시트는 접근 시 SecurityError 를 던지므로 hooks 쪽에서 try/catch 로 판별해 이 함수에 넘긴다.
 * 규칙을 읽을 수 있으면 adopt(폰트·다크토큰까지 온전 복제), 못 읽으면 <link>/<style> 노드 복제
 * 폴백(Vite dev=주입 <style>, build=<link> 모두 커버).
 */
export function planStyleClone(
  sheetCount: number,
  canReadRules: (index: number) => boolean,
): StyleCloneStep[] {
  const steps: StyleCloneStep[] = [];
  for (let i = 0; i < sheetCount; i += 1) {
    steps.push(canReadRules(i) ? { mode: 'adopt', index: i } : { mode: 'clone-node', index: i });
  }
  return steps;
}

/**
 * <html> 루트에서 PiP 문서로 그대로 옮길 시각 속성 목록.
 * color-scheme·다크 배경·폰트 토큰이 여기에 실려 새 창이 메인과 동일하게 보인다.
 * (className 은 별도로 통째 복사하므로 style 인라인 속성만 나열)
 */
export const ROOT_STYLE_PROPS = [
  'color-scheme',
  'background-color',
  'background',
  'color',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 재도킹 상태 전이 (분리 ↔ 도킹)
// ─────────────────────────────────────────────────────────────────────────────

/** 분리 작업대의 생명주기 상태 */
export type DetachPhase = 'docked' | 'opening' | 'detached';

/** 상태 전이 입력 이벤트 */
export type DetachEvent =
  /** 사용자가 '별도 창으로 분리' 클릭 (제스처) */
  | { readonly type: 'request-open' }
  /** requestWindow/open 성공해 창이 실제로 떴다 */
  | { readonly type: 'opened' }
  /** requestWindow/open 실패(팝업 차단 등) — 도킹 유지 */
  | { readonly type: 'open-failed' }
  /** 사용자가 창을 닫음(pagehide) 또는 '메인으로 되돌리기' 클릭 */
  | { readonly type: 'closed' };

/**
 * 분리 상태 전이 (순수). 중복 오픈 금지: opening/detached 중 request-open 은 무시.
 * open-failed·closed 는 항상 docked 로 복귀(재도킹). 상태(측정·측점·항목)는 Zustand
 * 싱글턴이라 자동 동기이므로 여기서 다루지 않는다.
 */
export function detachReducer(phase: DetachPhase, event: DetachEvent): DetachPhase {
  switch (event.type) {
    case 'request-open':
      // 이미 열려 있거나 여는 중이면 무시(한 번에 하나).
      return phase === 'docked' ? 'opening' : phase;
    case 'opened':
      return 'detached';
    case 'open-failed':
      return 'docked';
    case 'closed':
      return 'docked';
    default:
      return phase;
  }
}

/** 분리 중(=메인 도크 본문을 슬림 바로 대체) 여부 */
export function isDetached(phase: DetachPhase): boolean {
  return phase === 'detached';
}
