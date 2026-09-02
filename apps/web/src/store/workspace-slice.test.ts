/**
 * 워크스페이스 순수 로직 테스트 — 스냅샷 저장·복원 왕복, 재열기 제자리 교체,
 * 활성 도면 닫기 시 인접 전환, 역할 변경 (jsdom 불필요, 순수 함수만).
 */
import type { Calibration, DrawingModel } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '../canvas/transform.ts';
import type { DrawingTab } from './types.ts';
import {
  closeDrawingAt,
  type LiveDrawingState,
  setRole,
  snapshotActive,
  upsertDrawing,
} from './workspace-slice.ts';

/** 최소 DrawingModel 스텁 — 순수 함수는 model을 참조만 하므로 형태만 맞춘다 */
function model(entityCount: number): DrawingModel {
  return {
    dxfVersion: 'AC1015',
    insUnits: 6,
    layers: [],
    entities: Array.from(
      { length: entityCount },
      () => ({ kind: 'line' }) as DrawingModel['entities'][number],
    ),
    unsupportedCounts: {},
    sanitizedCount: 0,
    paperSpaceExcludedCount: 0,
    orphanedBlockCount: 0,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  };
}

const VP0: Viewport = { center: { x: 0, y: 0 }, pxPerUnit: 1 };

function tab(id: string, storageKey: string, overrides: Partial<DrawingTab> = {}): DrawingTab {
  return {
    id,
    fileName: `${id}.dxf`,
    role: 'other',
    entityCount: 3,
    storageKey,
    model: model(3),
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 1 },
    calibration: null,
    layerVisibility: {},
    ...overrides,
  };
}

describe('snapshotActive — 라이브 상태 → 활성 탭 스냅샷', () => {
  it('활성 탭에만 viewport/calibration/layerVisibility를 병합한다', () => {
    const drawings = [tab('a', 'ka'), tab('b', 'kb')];
    const cal: Calibration = {
      method: 'two-point',
      p1: { x: 0, y: 0 },
      p2: { x: 1, y: 0 },
      drawingDistance: 1,
      realDistance_m: 2,
      scale: 2,
      calibratedAt: '2026-08-29T00:00:00.000Z',
    };
    const live: LiveDrawingState = {
      model: model(3),
      viewport: { center: { x: 111, y: 222 }, pxPerUnit: 5 },
      calibration: cal,
      layerVisibility: { L0: false },
    };

    const next = snapshotActive(drawings, 'b', live);
    const a = next.find((d) => d.id === 'a');
    const b = next.find((d) => d.id === 'b');
    expect(a?.viewport).toEqual(VP0); // 비활성 탭 불변
    expect(b?.viewport).toEqual({ center: { x: 111, y: 222 }, pxPerUnit: 5 });
    expect(b?.calibration).toBe(cal);
    expect(b?.layerVisibility).toEqual({ L0: false });
  });

  it('activeId가 null이면 원본 배열을 그대로 반환한다', () => {
    const drawings = [tab('a', 'ka')];
    const live: LiveDrawingState = {
      model: model(3),
      viewport: { center: { x: 9, y: 9 }, pxPerUnit: 9 },
      calibration: null,
      layerVisibility: {},
    };
    expect(snapshotActive(drawings, null, live)).toBe(drawings);
  });

  it('저장→복원 왕복: 전환 후 다시 돌아와도 viewport/calibration이 보존된다', () => {
    // a 활성, b로 전환하며 a 스냅샷 저장 → a로 재전환 시 저장값 유지 검증
    const drawings = [tab('a', 'ka'), tab('b', 'kb')];
    const aLive: LiveDrawingState = {
      model: model(3),
      viewport: { center: { x: 42, y: -7 }, pxPerUnit: 3.5 },
      calibration: null,
      layerVisibility: { road: false },
    };
    // a → b 전환: a의 라이브를 스냅샷
    const snapped = snapshotActive(drawings, 'a', aLive);
    const restoredA = snapped.find((d) => d.id === 'a');
    expect(restoredA?.viewport).toEqual({ center: { x: 42, y: -7 }, pxPerUnit: 3.5 });
    expect(restoredA?.layerVisibility).toEqual({ road: false });
  });
});

describe('upsertDrawing — 재열기 제자리 교체', () => {
  it('storageKey가 없으면 배열 끝에 추가한다 (reopened=false)', () => {
    const drawings = [tab('a', 'ka')];
    const r = upsertDrawing(drawings, tab('b', 'kb'));
    expect(r.reopened).toBe(false);
    expect(r.prev).toBeNull();
    expect(r.drawings).toHaveLength(2);
    expect(r.drawings[1]?.id).toBe('b');
  });

  it('storageKey가 같으면 같은 위치에서 교체(재열기)하고 길이는 그대로다', () => {
    const drawings = [tab('a', 'ka'), tab('b', 'kb'), tab('c', 'kc')];
    const reopened = tab('b2', 'kb', { fileName: 'b-reopened.dxf' });
    const r = upsertDrawing(drawings, reopened);
    expect(r.reopened).toBe(true);
    expect(r.prev?.id).toBe('b');
    expect(r.drawings).toHaveLength(3);
    expect(r.drawings[1]?.id).toBe('b2'); // 같은 인덱스에서 교체
    expect(r.drawings[1]?.fileName).toBe('b-reopened.dxf'); // 정체성(파일명)은 새 값
    expect(r.drawings.map((d) => d.storageKey)).toEqual(['ka', 'kb', 'kc']); // 순서 보존
  });

  it('재열기 시 기존 탭의 viewport/calibration/layerVisibility를 보존한다', () => {
    const liveCal: Calibration = {
      method: 'two-point',
      p1: { x: 0, y: 0 },
      p2: { x: 1, y: 0 },
      drawingDistance: 1,
      realDistance_m: 5,
      scale: 5,
      calibratedAt: '2026-08-29T00:00:00.000Z',
    };
    const existing = tab('b', 'kb', {
      viewport: { center: { x: 100, y: 200 }, pxPerUnit: 7 },
      calibration: liveCal,
      layerVisibility: { L0: false, road: true },
    });
    const drawings = [tab('a', 'ka'), existing];
    // 재열기 tab은 초기 viewport·복원 실패(null) 상태로 들어온다
    const reopened = tab('b2', 'kb', {
      fileName: 'b-reopened.dxf',
      viewport: { center: { x: 0, y: 0 }, pxPerUnit: 1 },
      calibration: null,
      layerVisibility: {},
    });
    const r = upsertDrawing(drawings, reopened);
    expect(r.reopened).toBe(true);
    const merged = r.drawings[1];
    expect(merged?.id).toBe('b2');
    expect(merged?.fileName).toBe('b-reopened.dxf'); // 정체성은 교체
    expect(merged?.viewport).toEqual({ center: { x: 100, y: 200 }, pxPerUnit: 7 }); // 라이브 유지
    expect(merged?.calibration).toBe(liveCal); // 라이브 캘리브레이션 유지
    expect(merged?.layerVisibility).toEqual({ L0: false, road: true }); // 라이브 레이어 유지
  });
});

describe('closeDrawingAt — 인접 전환·빈 상태', () => {
  it('비활성 탭을 닫으면 활성 유지', () => {
    const drawings = [tab('a', 'ka'), tab('b', 'kb'), tab('c', 'kc')];
    const r = closeDrawingAt(drawings, 'b', 'a');
    expect(r.drawings.map((d) => d.id)).toEqual(['b', 'c']);
    expect(r.nextActiveId).toBe('b');
  });

  it('활성 탭을 닫으면 오른쪽 인접으로 전환한다', () => {
    const drawings = [tab('a', 'ka'), tab('b', 'kb'), tab('c', 'kc')];
    const r = closeDrawingAt(drawings, 'b', 'b');
    expect(r.drawings.map((d) => d.id)).toEqual(['a', 'c']);
    expect(r.nextActiveId).toBe('c'); // 오른쪽 우선
  });

  it('활성이 마지막 탭이면 왼쪽으로 전환한다', () => {
    const drawings = [tab('a', 'ka'), tab('b', 'kb'), tab('c', 'kc')];
    const r = closeDrawingAt(drawings, 'c', 'c');
    expect(r.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    expect(r.nextActiveId).toBe('b'); // 오른쪽 없음 → 왼쪽
  });

  it('마지막 하나 남은 탭을 닫으면 빈 상태(null)가 된다', () => {
    const drawings = [tab('a', 'ka')];
    const r = closeDrawingAt(drawings, 'a', 'a');
    expect(r.drawings).toHaveLength(0);
    expect(r.nextActiveId).toBeNull();
  });

  it('존재하지 않는 id를 닫으면 변화 없음', () => {
    const drawings = [tab('a', 'ka')];
    const r = closeDrawingAt(drawings, 'a', 'zzz');
    expect(r.drawings).toBe(drawings);
    expect(r.nextActiveId).toBe('a');
  });
});

describe('setRole — 역할 변경', () => {
  it('해당 id의 역할만 바꾸고 나머지는 불변', () => {
    const drawings = [tab('a', 'ka', { role: 'plan' }), tab('b', 'kb', { role: 'other' })];
    const next = setRole(drawings, 'b', 'cross-section');
    expect(next.find((d) => d.id === 'a')?.role).toBe('plan');
    expect(next.find((d) => d.id === 'b')?.role).toBe('cross-section');
  });
});
