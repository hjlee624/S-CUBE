/**
 * useDetachedWindow — 수량산출 작업대를 별도 OS 창(Document Picture-in-Picture)으로 분리.
 *
 * 반환한 container(=PiP document.body 하위 마운트 노드)에 호출부가 createPortal 로 컴포넌트를
 * 렌더한다. 상태는 Zustand 싱글턴이라 새 창에서 편집해도 메인에 즉시 반영된다(prop drilling 금지).
 *
 * 핵심 제약:
 *  - requestWindow 는 반드시 사용자 제스처(클릭) 동기 경로에서 호출 — open() 안에서 await 전에 부른다.
 *  - 스타일 복제 필수: 안 하면 새 창이 무스타일. 동일 출처 시트는 CSSStyleSheet 로 복제해
 *    adoptedStyleSheets 에 추가, 실패(cross-origin)하면 <link>/<style> 노드를 cloneNode.
 *  - 한 번에 하나만(중복 오픈 금지). 창 닫힘(pagehide)·언마운트 시 정리.
 *  - 미지원이면 window.open 폴백, 팝업 차단되면 도킹 유지(콜백으로 안내).
 *
 * 순수 판별·계획·전이는 lib/detached-window.ts 로 분리해 테스트한다(여기는 DOM 접착만).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type DetachPhase,
  detachReducer,
  isDetached as isDetachedPhase,
  isPopupBlocked,
  type PipCapableWindow,
  pickOpenStrategy,
  planStyleClone,
  popupFeatures,
  ROOT_STYLE_PROPS,
  supportsDocumentPip,
} from '../lib/detached-window.ts';

/** 열기 옵션 */
export interface DetachedWindowOptions {
  width?: number;
  height?: number;
  /** 새 창 제목(document.title) */
  title?: string;
  /** 팝업 차단 등 열기 실패 시 안내용 콜백(토스트 등) */
  onBlocked?: () => void;
}

export interface UseDetachedWindow {
  /** portal 마운트 노드 — 분리 중이면 PiP body 하위 <div>, 아니면 null */
  container: HTMLElement | null;
  /** 별도 창이 실제로 열려 있는가 */
  isDetached: boolean;
  /** 별도 창 열기 (반드시 클릭 핸들러 안에서 호출) */
  open: () => void;
  /** 별도 창 닫고 재도킹 */
  close: () => void;
  /** 별도 창 분리 가능 여부(Document PiP 지원). 폴백까지 감안한 실사용 가능 여부는 항상 시도) */
  supported: boolean;
}

/** 동일 출처 시트인지 — cssRules 접근을 시도해 SecurityError 를 잡는다 */
function canReadSheetRules(sheet: CSSStyleSheet): boolean {
  try {
    // cssRules 접근만으로 cross-origin 이면 예외. length 참조로 강제 평가.
    return sheet.cssRules.length >= 0;
  } catch {
    return false;
  }
}

/**
 * constructed-sheet 로는 온전히 복제할 수 없는 규칙이 있는지.
 * - @import(CSSRule.IMPORT_RULE=3): constructed stylesheet 는 insertRule 로 @import 금지(SyntaxError).
 * - @property(CSSRule.PROPERTY_RULE=63): cssText 왕복이 lossy 라 registration 유실 → owner 노드 복제로 우회.
 * cssRules 는 동일 출처에서만 접근하므로 호출부에서 canReadSheetRules 통과 후 사용.
 */
const IMPORT_RULE = 3;
const PROPERTY_RULE = 63;
function hasNonPortableRule(sheet: CSSStyleSheet): boolean {
  try {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule.type === IMPORT_RULE || rule.type === PROPERTY_RULE) return true;
      // @property 는 일부 엔진에서 type 이 0(unknown) — constructor 이름으로도 확인.
      if (rule.constructor?.name === 'CSSPropertyRule') return true;
    }
    return false;
  } catch {
    // 읽다 실패하면 안전하게 노드 복제 쪽으로.
    return true;
  }
}

/** owner 노드(<link>/<style>)를 대상 realm 으로 복제해 head 에 append. 성공하면 true. */
function cloneOwnerNode(sheet: CSSStyleSheet, dst: Document): boolean {
  const owner = sheet.ownerNode;
  if (owner == null) return false;
  // importNode 로 대상 document realm 에 맞춰 복제(cloneNode 는 원본 realm 노드를 반환).
  dst.head.appendChild(dst.importNode(owner, true));
  return true;
}

/**
 * 메인 document 의 모든 스타일을 PiP document 로 복제한다.
 *
 * 전략(핵심 수정):
 *  1) owner 노드(<link>/<style>)가 있으면 그 노드를 복제하는 것을 1순위로 한다 — @import/@property/@layer
 *     순서까지 원본 그대로 보존(Vite dev 주입 <style>·build <link> 모두 커버).
 *  2) ownerNode 가 null(런타임 생성 시트 등)인 경우에만 constructed-sheet 로 규칙을 복제해 adopt.
 *     이때 clone 은 반드시 **대상 realm** 의 CSSStyleSheet 로 생성해야 한다(메인 realm 것을 adopt 하면
 *     NotAllowedError). adopt 자체도 별도 try/catch 로 감싸 실패한 시트는 owner 노드 복제로 폴백.
 *  3) <html> class/style(color-scheme·다크 배경·폰트 토큰) 과 body 배경/폰트를 PiP 로 반영.
 */
function cloneStyles(src: Document, dst: Document): void {
  const sheets = Array.from(src.styleSheets);
  const steps = planStyleClone(sheets.length, (i) => {
    const s = sheets[i];
    return s != null && canReadSheetRules(s);
  });

  // 대상 realm 의 생성자로 clone 을 만든다(cross-realm adopt = NotAllowedError 회피).
  const TargetSheet = dst.defaultView?.CSSStyleSheet ?? CSSStyleSheet;
  const adopted: CSSStyleSheet[] = [];

  for (const step of steps) {
    const sheet = sheets[step.index];
    if (sheet == null) continue;

    // clone-node(cross-origin 등 규칙 접근 불가) — owner 노드 복제만 가능.
    if (step.mode === 'clone-node') {
      cloneOwnerNode(sheet, dst);
      continue;
    }

    // adopt 후보(동일 출처). owner 노드가 있거나 비이식 규칙(@import/@property)이면 노드 복제 우선.
    if (sheet.ownerNode != null || hasNonPortableRule(sheet)) {
      if (cloneOwnerNode(sheet, dst)) continue;
      // owner 가 있다고 판단했으나 복제 실패 — constructed-sheet 로 마지막 시도(아래로 낙하).
    }

    // ownerNode 가 없는 시트만 constructed-sheet 로 복제해 adopt 대기열에 넣는다.
    try {
      const clone = new TargetSheet();
      for (const rule of Array.from(sheet.cssRules)) {
        // @import 는 constructed sheet 에서 금지 → 건너뛰고 나머지 규칙만 복제.
        if (rule.type === IMPORT_RULE) continue;
        clone.insertRule(rule.cssText, clone.cssRules.length);
      }
      adopted.push(clone);
    } catch {
      // 규칙 복제 실패 시 owner 노드 복제로 폴백(없으면 무시).
      cloneOwnerNode(sheet, dst);
    }
  }

  if (adopted.length > 0) {
    // cross-realm/부적합 시 NotAllowedError 가 던져질 수 있어 별도 try/catch — 개별 시트로 재시도 후
    // 그래도 실패하는 시트는 owner 노드 복제로 폴백(전체 스타일 유실 방지).
    try {
      dst.adoptedStyleSheets = [...dst.adoptedStyleSheets, ...adopted];
    } catch {
      for (const sheet of adopted) {
        try {
          dst.adoptedStyleSheets = [...dst.adoptedStyleSheets, sheet];
        } catch {
          // 개별 adopt 도 실패 — 이 시트는 포기(ownerNode 없는 시트라 노드 폴백 불가).
        }
      }
    }
  }

  // <html> — className 통째 복사 + 시각 인라인 스타일 반영(color-scheme·다크 배경 등).
  dst.documentElement.className = src.documentElement.className;
  for (const prop of ROOT_STYLE_PROPS) {
    const v = src.documentElement.style.getPropertyValue(prop);
    if (v !== '') dst.documentElement.style.setProperty(prop, v);
  }
  // body — className + 배경/폰트 토큰이 시트에 있으면 자동 적용되지만, 인라인/계산값도 보강.
  dst.body.className = src.body.className;
  const bodyStyle = src.defaultView?.getComputedStyle(src.body);
  if (bodyStyle != null) {
    dst.body.style.backgroundColor = bodyStyle.backgroundColor;
    dst.body.style.color = bodyStyle.color;
    dst.body.style.fontFamily = bodyStyle.fontFamily;
  }
  dst.body.style.margin = '0';
}

/** PiP body 에 portal 마운트 노드를 만들고 반환 */
function mountContainer(doc: Document): HTMLElement {
  const el = doc.createElement('div');
  el.style.height = '100%';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  doc.body.appendChild(el);
  return el;
}

/**
 * window.open('') 폴백 팝업을 document 가 준비된 뒤 mount 한다.
 *
 * 일부 엔진은 open('') 직후 document.write/close 로 넣은 문서를 **비동기로 교체**한다.
 * finishOpen 을 동기로 부르면 mountContainer 의 appendChild 가 곧 버려질 body 에 붙어
 * 무스타일/빈 창이 된다. readyState 가 'complete' 이고 body 가 실재할 때까지 폴링(짧게)해서
 * 안정된 문서에 mount 하도록 한다. 타임아웃 후에는 있는 body 에라도 mount(폴백의 폴백).
 */
const POPUP_READY_TIMEOUT_MS = 2000;
const POPUP_POLL_INTERVAL_MS = 30;
function openPopupWhenReady(popup: Window, mount: (win: Window) => void): void {
  const ensureBody = (): boolean => {
    try {
      if (popup.document.body != null) return true;
      // 빈 문서라 head/body 를 직접 구성.
      popup.document.write('<!doctype html><html><head></head><body></body></html>');
      popup.document.close();
      return popup.document.body != null;
    } catch {
      return false;
    }
  };

  const isReady = (): boolean => {
    try {
      return popup.document.readyState === 'complete' && popup.document.body != null;
    } catch {
      return false;
    }
  };

  ensureBody();
  if (isReady()) {
    mount(popup);
    return;
  }

  const start = Date.now();
  const tick = (): void => {
    if (popup.closed) return; // 사용자가 닫음 — pagehide 가 없을 수 있으니 그냥 종료.
    ensureBody();
    if (isReady() || Date.now() - start >= POPUP_READY_TIMEOUT_MS) {
      mount(popup);
      return;
    }
    popup.setTimeout(tick, POPUP_POLL_INTERVAL_MS);
  };
  popup.setTimeout(tick, POPUP_POLL_INTERVAL_MS);
}

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;

export function useDetachedWindow(options: DetachedWindowOptions = {}): UseDetachedWindow {
  const {
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    title = 'S-CUBE 수량산출',
    onBlocked,
  } = options;

  const [phase, setPhase] = useState<DetachPhase>('docked');
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const winRef = useRef<Window | null>(null);
  // requestWindow 가 pending 인 동안 close()/언마운트가 나면 세워지는 취소 플래그.
  // finishOpen 이 뒤늦게 resolve 돼도 이 값이 true 면 창을 닫고 마운트하지 않는다(누수 방지).
  const cancelledRef = useRef(false);
  // 최신 콜백을 리스너에서 참조하기 위한 ref(리스너 재등록 없이 최신값 유지).
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  const supported = supportsDocumentPip(window as unknown as PipCapableWindow);

  /** 창 정리 — 리스너 해제·close·상태 리셋 (재도킹) */
  const teardown = useCallback((closeWindow: boolean) => {
    // pending 오픈이 있으면 뒤늦은 finishOpen 을 취소(창 닫고 마운트 skip).
    cancelledRef.current = true;
    const win = winRef.current;
    winRef.current = null;
    setContainer(null);
    if (win != null) {
      win.removeEventListener('pagehide', handlePagehideRef.current);
      if (closeWindow && !win.closed) win.close();
    }
    // opening 중 취소도 docked 로 리셋되도록 closed 전이(reducer 는 opening→docked 처리).
    setPhase((p) => detachReducer(p, { type: 'closed' }));
  }, []);

  // pagehide 핸들러를 ref 로 안정화(add/remove 짝 보장).
  const handlePagehideRef = useRef<() => void>(() => {});
  handlePagehideRef.current = () => teardown(false);

  const finishOpen = useCallback(
    (win: Window) => {
      // requestWindow/open pending 사이에 close()·언마운트가 났으면 창만 닫고 즉시 반환.
      // (마운트하면 소유자 없는 창에 container·리스너가 남아 OS 창/리스너 누수 + setState-after-unmount)
      if (cancelledRef.current) {
        try {
          if (!win.closed) win.close();
        } catch {
          // 이미 닫혔거나 접근 불가 — 무시.
        }
        return;
      }
      const doc = win.document;
      doc.title = title;
      cloneStyles(document, doc);
      const el = mountContainer(doc);
      winRef.current = win;
      win.addEventListener('pagehide', handlePagehideRef.current);
      setContainer(el);
      setPhase((p) => detachReducer(p, { type: 'opened' }));
    },
    [title],
  );

  const open = useCallback(() => {
    // 중복 오픈 금지 — reducer 로 상태만 계산해 이미 열림/여는 중이면 무시.
    let allowed = false;
    setPhase((p) => {
      const next = detachReducer(p, { type: 'request-open' });
      allowed = next === 'opening' && p === 'docked';
      return next;
    });
    if (!allowed) return;

    // 새 오픈 시작 — 이전 취소 플래그 해제(뒤늦은 finishOpen 만 막는 용도).
    cancelledRef.current = false;

    const pipWin = window as unknown as PipCapableWindow;
    const strategy = pickOpenStrategy(pipWin);

    if (strategy === 'document-pip' && pipWin.documentPictureInPicture != null) {
      // requestWindow 는 제스처 동기 경로에서 호출(여기서 await 전 호출됨).
      pipWin.documentPictureInPicture
        .requestWindow({ width, height })
        .then((pip) => finishOpen(pip.window))
        .catch(() => {
          setPhase((p) => detachReducer(p, { type: 'open-failed' }));
          onBlockedRef.current?.();
        });
      return;
    }

    // 폴백 — window.open. 팝업 차단되면 도킹 유지 + 안내.
    const popup = pipWin.open('', '_blank', popupFeatures(width, height));
    // isPopupBlocked 로 판정하되, TS 흐름 좁힘을 위해 popup == null 도 함께 확인.
    if (popup == null || isPopupBlocked(popup)) {
      setPhase((p) => detachReducer(p, { type: 'open-failed' }));
      onBlockedRef.current?.();
      return;
    }
    openPopupWhenReady(popup, finishOpen);
  }, [width, height, finishOpen]);

  const close = useCallback(() => teardown(true), [teardown]);

  // 언마운트 시 창 닫기 + 리스너 정리 + 상태 리셋(StrictMode/Fast Refresh phase 탈동기 방지).
  useEffect(() => {
    return () => {
      // pending 오픈이 있으면 뒤늦은 finishOpen 이 창을 닫도록 취소 플래그를 세운다.
      cancelledRef.current = true;
      const win = winRef.current;
      winRef.current = null;
      if (win != null) {
        win.removeEventListener('pagehide', handlePagehideRef.current);
        if (!win.closed) win.close();
      }
      // container 는 죽은 창을 가리키므로 반드시 비운다. phase 도 docked 로 되돌려
      // redock UI 가 죽은 winRef 를 붙든 채 남지 않게 한다(container==null 가드와도 정합).
      setContainer(null);
      setPhase((p) => detachReducer(p, { type: 'closed' }));
    };
  }, []);

  return {
    container,
    isDetached: isDetachedPhase(phase),
    open,
    close,
    supported,
  };
}
