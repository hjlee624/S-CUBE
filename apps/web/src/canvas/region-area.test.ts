/**
 * RW-28 영역 면적 통합 테스트 — 스토어+캔버스 액션 전 과정 검증:
 * 대상 셀 지정 → 범위 탐지(detectFacesInRect) → 선택 → 확정(confirmRegionSelection) → 셀 누적.
 *
 * 싱글턴 store(useAppStore)와 scene(R-tree)를 실제로 세팅해, 사용자 흐름(◎취득 후 2점 범위)의
 * 로직이 실제 측점 셀 면적으로 이어지는지 node 환경에서 확인한다.
 */
import type { Calibration, StationSection } from '@s-cube/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAndNormalizeDxf } from '../lib/core-api.ts';
import { useAppStore } from '../store/index.ts';
import { confirmRegionSelection, detectFacesInRect } from './actions.ts';
import { setSceneModel } from './scene.ts';

/** 사각형(0,0)~(100,100) + 두 대각선 — 교차분할 시 삼각형 4개(각 2500) 생성 */
function squareWithDiagonalsDxf(): string {
  const line = (h: string, x1: number, y1: number, x2: number, y2: number): string =>
    ['0', 'LINE', '5', h, '8', '0', '10', `${x1}`, '20', `${y1}`, '11', `${x2}`, '21', `${y2}`].join(
      '\n',
    );
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    line('A', 0, 0, 100, 0),
    line('B', 100, 0, 100, 100),
    line('C', 100, 100, 0, 100),
    line('D', 0, 100, 0, 0),
    line('E', 0, 0, 100, 100),
    line('F', 100, 0, 0, 100),
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');
}

const CAL: Calibration = {
  method: 'two-point',
  p1: { x: 0, y: 0 },
  p2: { x: 100, y: 0 },
  drawingDistance: 100,
  realDistance_m: 100,
  scale: 1, // 1 도면단위 = 1 m → 면적 도면단위²=㎡
  calibratedAt: '2026-01-01T00:00:00.000Z',
};

describe('영역 면적 통합 (RW-28)', () => {
  beforeEach(() => {
    const model = parseAndNormalizeDxf(squareWithDiagonalsDxf());
    setSceneModel(model);
    const section: StationSection = {
      id: 'sec-1',
      station: { raw: 'No.1', no: 1, plus_m: 0, chainage_m: 20, discontinuity: null },
      itemKey: '절토',
      area_m2: 0,
    };
    useAppStore.setState({
      model,
      activeId: 'd1',
      calibration: CAL,
      viewport: { center: { x: 50, y: 50 }, pxPerUnit: 1 },
      sections: [section],
      itemKeys: ['절토'],
      regionFaces: [],
      measurements: [],
      selectedMeasurementIds: [],
      activeStationId: null,
      activeItemKey: null,
    });
  });

  it('범위 탐지 → 삼각형 면들 검출(외곽 사각형은 maxArea 제외)', () => {
    detectFacesInRect({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    const faces = useAppStore.getState().regionFaces;
    // 삼각형 4개(각 2500). 외곽 10000 은 bounds(10000)×0.5=5000 초과라 제외.
    expect(faces.length).toBe(4);
    expect(faces.every((f) => Math.abs(f.areaRaw - 2500) < 1)).toBe(true);
    expect(faces.every((f) => f.selected)).toBe(true);
  });

  it('대상 셀 지정 + 선택 확정 → 측점 셀에 면적 누적 기입', () => {
    // ◎취득 상당: 대상 셀 지정
    useAppStore.getState().setAreaTargetCell('sec-1', '절토');
    detectFacesInRect({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    expect(useAppStore.getState().regionFaces.length).toBe(4);
    // 전부 선택된 상태로 확정(누적) → 4×2500 = 10000 ㎡ (scale 1)
    confirmRegionSelection(true);
    const sec = useAppStore.getState().sections.find((s) => s.itemKey === '절토');
    expect(sec?.area_m2).toBeCloseTo(10000, 3);
    // 탐지 상태는 확정 후 초기화
    expect(useAppStore.getState().regionFaces).toHaveLength(0);
  });

  it('일부만 선택하면 선택분만 합산 누적', () => {
    useAppStore.getState().setAreaTargetCell('sec-1', '절토');
    detectFacesInRect({ minX: -10, minY: -10, maxX: 110, maxY: 110 });
    const faces = useAppStore.getState().regionFaces;
    // 2개만 선택 해제 → 2개(5000)만 남김
    useAppStore.getState().toggleRegionFace(faces[0]!.id);
    useAppStore.getState().toggleRegionFace(faces[1]!.id);
    confirmRegionSelection(true);
    const sec = useAppStore.getState().sections.find((s) => s.itemKey === '절토');
    expect(sec?.area_m2).toBeCloseTo(5000, 3);
  });
});
