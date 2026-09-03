import { describe, expect, it } from 'vitest';
import {
  migrateScubeProject,
  parseScubeProject,
  type ScubeProject,
  ScubeProjectSchema,
  serializeScubeProject,
} from './project.ts';
import { SCHEMA_VERSION } from './version.ts';

/** 최소 합성 프로젝트 — 각 배열에 1건씩 채워 왕복 검증 */
function makeProject(): ScubeProject {
  return {
    schemaVersion: 1,
    meta: {
      projectName: '곡성 지구 도로확포장',
      author: '홍길동',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      stationInterval_m: 20,
      reviewer: '김감리',
      drawingNo: 'A-101',
    },
    drawings: [
      {
        id: 'dwg-1',
        fileName: 'plan.dxf',
        role: 'plan',
        entityCount: 100,
        contentHash: 's-cube:cal:v1:abcd1234',
        filePath: 'C:/proj/plan.dxf',
        sha256: 'abc123',
        dxfVersion: 'AC1015',
        insUnits: 6,
        calibration: null,
        layers: [{ name: '0', colorIndex: 7, visible: true, entityCount: 100 }],
        loadedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    measurements: [
      {
        id: 'm-1',
        drawingId: 'dwg-1',
        kind: 'area',
        value: 12.5,
        rawValue: 12500,
        method: 'polyline',
        sourceHandles: ['1A2B'],
        label: '절토부',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    sections: [
      {
        id: 'ss-1',
        station: { raw: 'No.8+0.000', no: 8, plus_m: 0, chainage_m: 160, discontinuity: null },
        itemKey: '절토',
        area_m2: 12.5,
        measurementId: 'm-1',
      },
    ],
    items: [
      {
        id: 'ti-1',
        workType: '토공사',
        specCode: 'EARTH-CUT-SOIL',
        unit: '㎥',
        quantity: 300,
        basis: {
          op: 'avgEndArea',
          a1: { op: 'ref', cell: 'section:ss-1:area', label: 'A1(㎡)' },
          a2: { op: 'ref', cell: 'section:ss-2:area', label: 'A2(㎡)' },
          length: { op: 'const', value: 20, label: 'L(m)' },
        },
        sourceRefs: [{ drawingId: 'dwg-1', handles: ['1A2B'] }],
      },
    ],
    specs: [
      {
        code: 'EARTH-CUT-SOIL',
        workType: '토공사',
        name: '흙깎기',
        spec: '보통토사',
        unit: '㎥',
        calcType: 'section-length',
      },
    ],
    history: [
      {
        id: 'h-1',
        at: '2026-01-02T00:00:00.000Z',
        actor: '홍길동',
        kind: 'item',
        targetId: 'ti-1',
        detail: '절토 항목 생성',
      },
    ],
    layerRules: [],
  };
}

describe('ScubeProjectSchema', () => {
  it('직렬화 → 파싱 왕복이 동일 객체를 반환한다', () => {
    const project = makeProject();
    const json = serializeScubeProject(project);
    const parsed = parseScubeProject(json);
    expect(parsed).toEqual(project);
  });

  it('직접 파싱도 통과한다', () => {
    expect(ScubeProjectSchema.parse(makeProject())).toEqual(makeProject());
  });

  it('schemaVersion 은 리터럴 1 만 허용한다', () => {
    const bad = { ...makeProject(), schemaVersion: 2 } as unknown;
    expect(ScubeProjectSchema.safeParse(bad).success).toBe(false);
  });

  it('drawings 는 경로+sha256 참조만 담는다 (임베드 없음)', () => {
    const project = makeProject();
    const drawing = project.drawings[0];
    expect(drawing).toBeDefined();
    expect(drawing).not.toHaveProperty('entities');
    expect(drawing?.sha256).toBe('abc123');
  });
});

describe('migrateScubeProject', () => {
  it('버전 1 은 변환 없이 통과한다', () => {
    const project = makeProject();
    expect(migrateScubeProject(project)).toEqual(project);
  });

  it('schemaVersion 누락은 에러', () => {
    expect(() => migrateScubeProject({ meta: {} })).toThrow(/schemaVersion/);
  });

  it('지원 상위 버전은 에러로 승격한다 (조용한 손실 금지)', () => {
    expect(() =>
      migrateScubeProject({ ...makeProject(), schemaVersion: SCHEMA_VERSION + 1 }),
    ).toThrow(/지원하지 않는/);
  });

  it('schemaVersion 이 숫자가 아니면 에러', () => {
    expect(() => migrateScubeProject({ ...makeProject(), schemaVersion: '1' })).toThrow(/숫자/);
  });
});
