/**
 * 분리 작업대 순수 로직 테스트 — 지원 판별·열기 전략·스타일 복제 계획·재도킹 전이.
 * DOM 비의존(문서 stub·카운트만)이라 node 환경(vitest 기본)에서 그대로 돈다.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  canDetach,
  detachReducer,
  isDetached,
  isPopupBlocked,
  type PipCapableWindow,
  pickOpenStrategy,
  planStyleClone,
  popupFeatures,
  supportsDocumentPip,
} from './detached-window.ts';

/** documentPictureInPicture 있는/없는 창 stub */
function winWithPip(): PipCapableWindow {
  return {
    documentPictureInPicture: {
      window: null,
      requestWindow: () => Promise.resolve({ window: {} as Window }),
    },
    open: () => null,
  };
}

function winNoPip(): PipCapableWindow {
  return { open: () => null };
}

describe('supportsDocumentPip', () => {
  it('requestWindow 함수가 있으면 지원', () => {
    expect(supportsDocumentPip(winWithPip())).toBe(true);
  });

  it('documentPictureInPicture 없으면 미지원', () => {
    expect(supportsDocumentPip(winNoPip())).toBe(false);
  });

  it('속성만 있고 requestWindow 가 함수 아니면 미지원(부분구현 방어)', () => {
    const win = { documentPictureInPicture: { window: null } } as unknown as PipCapableWindow;
    expect(supportsDocumentPip(win)).toBe(false);
  });

  it('null/undefined 창은 미지원', () => {
    expect(supportsDocumentPip(undefined)).toBe(false);
    expect(supportsDocumentPip(null)).toBe(false);
  });
});

describe('canDetach', () => {
  it('PiP 지원이면 true', () => {
    expect(canDetach(winWithPip())).toBe(true);
  });

  it('PiP 미지원이라도 window.open 있으면 true(폴백 가능)', () => {
    expect(canDetach(winNoPip())).toBe(true);
  });

  it('창 자체가 없으면 false', () => {
    expect(canDetach(null)).toBe(false);
  });
});

describe('pickOpenStrategy — 폴백 분기', () => {
  it('PiP 지원이면 document-pip', () => {
    expect(pickOpenStrategy(winWithPip())).toBe('document-pip');
  });

  it('미지원이면 popup 폴백', () => {
    expect(pickOpenStrategy(winNoPip())).toBe('popup');
  });
});

describe('popupFeatures / isPopupBlocked', () => {
  it('width/height 를 반올림해 features 문자열 조립', () => {
    expect(popupFeatures(480.6, 640.2)).toBe('popup=yes,width=481,height=640');
  });

  it('open 이 null 이면 팝업 차단으로 판정', () => {
    expect(isPopupBlocked(null)).toBe(true);
    expect(isPopupBlocked({} as Window)).toBe(false);
  });
});

describe('planStyleClone — 스타일 복제 대상 수집', () => {
  it('규칙 읽기 가능한 시트는 adopt, 불가한 시트는 clone-node', () => {
    // index 1 만 cross-origin(규칙 접근 실패)이라고 가정.
    const canRead = (i: number) => i !== 1;
    const steps = planStyleClone(3, canRead);
    expect(steps).toEqual([
      { mode: 'adopt', index: 0 },
      { mode: 'clone-node', index: 1 },
      { mode: 'adopt', index: 2 },
    ]);
  });

  it('canReadRules 를 각 인덱스마다 정확히 한 번 호출', () => {
    const spy = vi.fn((_i: number) => true);
    planStyleClone(2, spy);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 0);
    expect(spy).toHaveBeenNthCalledWith(2, 1);
  });

  it('시트 0개면 빈 계획', () => {
    expect(planStyleClone(0, () => true)).toEqual([]);
  });
});

describe('detachReducer — 재도킹 상태 전이', () => {
  it('docked 에서 request-open → opening', () => {
    expect(detachReducer('docked', { type: 'request-open' })).toBe('opening');
  });

  it('opening 에서 opened → detached', () => {
    expect(detachReducer('opening', { type: 'opened' })).toBe('detached');
  });

  it('이미 detached 면 request-open 무시(중복 오픈 금지)', () => {
    expect(detachReducer('detached', { type: 'request-open' })).toBe('detached');
  });

  it('opening 중 request-open 도 무시(한 번에 하나)', () => {
    expect(detachReducer('opening', { type: 'request-open' })).toBe('opening');
  });

  it('open-failed → docked 복귀(팝업 차단 시 도킹 유지)', () => {
    expect(detachReducer('opening', { type: 'open-failed' })).toBe('docked');
  });

  it('closed → docked 재도킹(창 닫힘/되돌리기)', () => {
    expect(detachReducer('detached', { type: 'closed' })).toBe('docked');
  });
});

describe('isDetached', () => {
  it('detached 만 true', () => {
    expect(isDetached('detached')).toBe(true);
    expect(isDetached('docked')).toBe(false);
    expect(isDetached('opening')).toBe(false);
  });
});
