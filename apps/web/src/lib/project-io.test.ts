/**
 * ScubeProject 조립/직렬화/역직렬화 왕복 테스트 (Phase 4-D).
 *
 * 커버: assembleProject 가 03-DATA-MODEL §7 구조를 만들고 blocked 항목을 제외하는지,
 * serialize → deserialize 왕복이 동등한지, schemaVersion 상위 거절, 도면 무결성 대조.
 */
import type { MaterialSpec, Measurement, StationSection } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import {
  assembleProject,
  checkDrawingIntegrity,
  deserializeProject,
  type ProjectAssemblyInput,
  serializeProject,
} from './project-io.ts';
import type { EditableTakeoffItem } from './takeoff-derive.ts';

const NOW = '2026-01-01T00:00:00.000Z';

function measurement(id: string): Measurement {
  return {
    id,
    drawingId: 'd1',
    kind: 'area',
    value: 12.5,
    rawValue: 12500,
    method: 'polyline',
    sourceHandles: ['A1'],
    label: '절토부',
    createdAt: NOW,
  };
}

function section(id: string): StationSection {
  return {
    id,
    station: { raw: 'No.0+0', no: 0, plus_m: 0, chainage_m: 0, discontinuity: null },
    itemKey: '절토',
    area_m2: 10,
  };
}

function spec(): MaterialSpec {
  return {
    code: 'EARTH-CUT',
    workType: '토공사',
    name: '흙깎기',
    spec: '보통토사',
    unit: '㎥',
    calcType: 'section-length',
  };
}

function okItem(id: string): EditableTakeoffItem {
  return {
    id,
    workType: '토공사',
    name: '흙깎기',
    specCode: 'EARTH-CUT',
    unit: '㎥',
    source: { kind: 'manual', value: 240 },
    basis: { op: 'const', value: 240, label: '체적' },
    quantity: 240,
    blocked: false,
    sourceRefs: [{ drawingId: 'd1', handles: ['A1'] }],
  };
}

function blockedItem(id: string): EditableTakeoffItem {
  return {
    id,
    workType: '토공사',
    name: '절토(차단)',
    specCode: 'EARTH-CUT',
    unit: '㎥',
    source: { kind: 'segment-volume', itemKey: '절토' },
    basis: null,
    quantity: Number.NaN,
    blocked: true,
    sourceRefs: [],
  };
}

function baseInput(items: EditableTakeoffItem[]): ProjectAssemblyInput {
  return {
    meta: { projectName: '곡성 지구', author: '홍길동', stationInterval_m: 20 },
    drawings: [
      {
        id: 'd1',
        fileName: '평면도.dxf',
        role: 'plan',
        entityCount: 100,
        contentHash: 's-cube:cal:v1:abcd1234',
        dxfVersion: 'AC1015',
        insUnits: 6,
        calibration: null,
        layers: [{ name: '0', colorIndex: 7, visible: true, entityCount: 100 }],
      },
    ],
    measurements: [measurement('m1')],
    sections: [section('s1')],
    specs: [spec()],
    items,
  };
}

describe('assembleProject', () => {
  it('03-DATA-MODEL §7 구조를 만든다', () => {
    const { project } = assembleProject(baseInput([okItem('i1')]), NOW);
    expect(project.schemaVersion).toBe(1);
    expect(project.meta.projectName).toBe('곡성 지구');
    expect(project.meta.stationInterval_m).toBe(20);
    expect(project.meta.createdAt).toBe(NOW);
    expect(project.drawings).toHaveLength(1);
    expect(project.measurements).toHaveLength(1);
    expect(project.sections).toHaveLength(1);
    expect(project.specs).toHaveLength(1);
    expect(project.items).toHaveLength(1);
  });

  it('blocked(차단) 항목은 저장에서 제외하고 blockedItemIds 로 알린다', () => {
    const { project, blockedItemIds } = assembleProject(
      baseInput([okItem('i1'), blockedItem('i2')]),
      NOW,
    );
    expect(project.items).toHaveLength(1);
    expect(project.items[0]?.id).toBe('i1');
    expect(blockedItemIds).toEqual(['i2']);
  });

  it('existingCreatedAt 을 유지한다', () => {
    const input = { ...baseInput([okItem('i1')]), existingCreatedAt: '2025-06-01T00:00:00.000Z' };
    const { project } = assembleProject(input, NOW);
    expect(project.meta.createdAt).toBe('2025-06-01T00:00:00.000Z');
    expect(project.meta.updatedAt).toBe(NOW);
  });
});

describe('serialize → deserialize 왕복', () => {
  it('동등한 프로젝트를 복원한다', () => {
    const { project } = assembleProject(baseInput([okItem('i1')]), NOW);
    const text = serializeProject(project);
    const result = deserializeProject(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.meta.projectName).toBe('곡성 지구');
    expect(result.project.items).toHaveLength(1);
    expect(result.project.items[0]?.quantity).toBe(240);
    expect(result.project.drawings[0]?.contentHash).toBe('s-cube:cal:v1:abcd1234');
    expect(result.project.specs[0]?.code).toBe('EARTH-CUT');
  });

  it('손상 JSON 은 실패로 처리', () => {
    const result = deserializeProject('{ not json ');
    expect(result.ok).toBe(false);
  });

  it('schemaVersion 상위 버전은 거절', () => {
    const result = deserializeProject(JSON.stringify({ schemaVersion: 999, meta: {}, items: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // @s-cube/schema 위임 — 상위 스키마 버전 거절 메시지.
    expect(result.error).toContain('상위 스키마 버전');
  });
});

describe('checkDrawingIntegrity (P4-17)', () => {
  it('같은 이름·다른 해시면 경고', () => {
    const warnings = checkDrawingIntegrity(
      [{ fileName: '평면도.dxf', contentHash: 'OLD' }],
      [{ fileName: '평면도.dxf', contentHash: 'NEW' }],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('다릅니다');
  });

  it('아직 안 열린 도면은 경고하지 않는다(열 때 대조)', () => {
    const warnings = checkDrawingIntegrity([{ fileName: '평면도.dxf', contentHash: 'OLD' }], []);
    expect(warnings).toHaveLength(0);
  });

  it('해시가 같으면 경고 없음', () => {
    const warnings = checkDrawingIntegrity(
      [{ fileName: '평면도.dxf', contentHash: 'SAME' }],
      [{ fileName: '평면도.dxf', contentHash: 'SAME' }],
    );
    expect(warnings).toHaveLength(0);
  });
});
