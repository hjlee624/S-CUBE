import {
  DRAWING_ROLE_LABELS,
  DRAWING_ROLES,
  type DrawingRole,
  DrawingRoleSchema,
  TAKEOFF_KIND_LABELS,
  TAKEOFF_KINDS,
  TakeoffKindSchema,
} from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { evaluateChecklist, TAKEOFF_REQUIREMENTS } from './checklist.ts';

describe('evaluateChecklist — 산출 전 필수도면 평가', () => {
  it('earthwork-section: cross-section 만 있으면 required 충족 satisfied=true, recommended 미충족 표시', () => {
    const result = evaluateChecklist('earthwork-section', ['cross-section']);
    expect(result.satisfied).toBe(true);
    expect(result.missingRequired).toHaveLength(0);

    const required = result.items.find((i) => i.necessity === 'required');
    expect(required?.present).toBe(true);
    expect(required?.presentRoles).toEqual(['cross-section']);

    const recommended = result.items.find((i) => i.necessity === 'recommended');
    expect(recommended?.present).toBe(false);
    expect(recommended?.presentRoles).toEqual([]);
  });

  it('earthwork-section: 아무 도면도 없으면 missingRequired 정확, satisfied=false', () => {
    const result = evaluateChecklist('earthwork-section', []);
    expect(result.satisfied).toBe(false);
    expect(result.missingRequired).toHaveLength(1);
    expect(result.missingRequired[0]?.anyOf).toEqual(['cross-section']);
    expect(result.missingRequired[0]?.reason).toBe('단면적(A1·A2) 취득');
    // recommended 는 missingRequired 에 들어가지 않는다
    expect(result.missingRequired.every((r) => r.necessity === 'required')).toBe(true);
  });

  it('earthwork-section: 횡단+종단 있으면 required·recommended 모두 충족', () => {
    const result = evaluateChecklist('earthwork-section', ['cross-section', 'profile']);
    expect(result.satisfied).toBe(true);
    expect(result.items.every((i) => i.present)).toBe(true);
  });

  it('structure: standard-detail 로 required(anyOf) 충족', () => {
    const result = evaluateChecklist('structure', ['standard-detail']);
    expect(result.satisfied).toBe(true);
    const required = result.items.find((i) => i.necessity === 'required');
    expect(required?.present).toBe(true);
    expect(required?.presentRoles).toEqual(['standard-detail']);
    // plan(권장) 은 여전히 미충족
    expect(result.items.find((i) => i.necessity === 'recommended')?.present).toBe(false);
  });

  it('structure: cross-section 으로도 required(anyOf) 충족', () => {
    const result = evaluateChecklist('structure', ['cross-section']);
    expect(result.satisfied).toBe(true);
  });

  it('structure: 둘 다(cross-section+standard-detail) 있으면 presentRoles 에 모두 기록', () => {
    const result = evaluateChecklist('structure', ['cross-section', 'standard-detail', 'plan']);
    expect(result.satisfied).toBe(true);
    const required = result.items.find((i) => i.necessity === 'required');
    expect(required?.presentRoles).toEqual(['cross-section', 'standard-detail']);
    expect(result.items.every((i) => i.present)).toBe(true);
  });

  it('area: plan 또는 cross-section 으로 required 충족', () => {
    expect(evaluateChecklist('area', ['plan']).satisfied).toBe(true);
    expect(evaluateChecklist('area', ['cross-section']).satisfied).toBe(true);
    expect(evaluateChecklist('area', ['profile']).satisfied).toBe(false);
  });

  it('linear: plan 또는 profile 로 required 충족', () => {
    expect(evaluateChecklist('linear', ['plan']).satisfied).toBe(true);
    expect(evaluateChecklist('linear', ['profile']).satisfied).toBe(true);
    expect(evaluateChecklist('linear', ['cross-section']).satisfied).toBe(false);
  });

  it('중복 역할 처리 — presentRoles 는 중복 없이 1회만', () => {
    const result = evaluateChecklist('earthwork-section', [
      'cross-section',
      'cross-section',
      'cross-section',
    ]);
    expect(result.satisfied).toBe(true);
    const required = result.items.find((i) => i.necessity === 'required');
    expect(required?.presentRoles).toEqual(['cross-section']);
  });

  it('순수 함수 — 입력 배열을 변경하지 않는다', () => {
    const input: DrawingRole[] = ['cross-section', 'plan'];
    const before = [...input];
    evaluateChecklist('earthwork-section', input);
    expect(input).toEqual(before);
  });

  it('items 순서는 TAKEOFF_REQUIREMENTS 정의 순서와 일치', () => {
    const result = evaluateChecklist('earthwork-section', []);
    expect(result.items.map((i) => i.necessity)).toEqual(['required', 'recommended']);
  });
});

describe('TAKEOFF_REQUIREMENTS — 정의 완전성·Zod', () => {
  it('모든 TakeoffKind 에 요구사항이 있고 required 가 최소 1개', () => {
    for (const kind of TAKEOFF_KINDS) {
      const reqs = TAKEOFF_REQUIREMENTS[kind];
      expect(reqs, kind).toBeDefined();
      expect(reqs.length, kind).toBeGreaterThan(0);
      expect(
        reqs.some((r) => r.necessity === 'required'),
        `${kind}: required 없음`,
      ).toBe(true);
    }
  });

  it('모든 anyOf 역할이 유효한 DrawingRole (Zod)', () => {
    for (const kind of TAKEOFF_KINDS) {
      for (const req of TAKEOFF_REQUIREMENTS[kind]) {
        expect(req.anyOf.length, `${kind}: anyOf 비어있음`).toBeGreaterThan(0);
        for (const role of req.anyOf) {
          expect(DrawingRoleSchema.safeParse(role).success, `${kind}: ${role}`).toBe(true);
        }
        expect(['required', 'recommended']).toContain(req.necessity);
        expect(req.reason.length, `${kind}: reason 비어있음`).toBeGreaterThan(0);
      }
    }
  });

  it('TakeoffKindSchema 는 TAKEOFF_KINDS 전부 통과', () => {
    for (const kind of TAKEOFF_KINDS) {
      expect(TakeoffKindSchema.safeParse(kind).success, kind).toBe(true);
    }
  });
});

describe('라벨 완전성', () => {
  it('DRAWING_ROLE_LABELS — 모든 DrawingRole 라벨 존재 (비어있지 않음)', () => {
    for (const role of DRAWING_ROLES) {
      expect(DRAWING_ROLE_LABELS[role], role).toBeTruthy();
    }
    expect(Object.keys(DRAWING_ROLE_LABELS).sort()).toEqual([...DRAWING_ROLES].sort());
  });

  it('TAKEOFF_KIND_LABELS — 모든 TakeoffKind 라벨 존재 (비어있지 않음)', () => {
    for (const kind of TAKEOFF_KINDS) {
      expect(TAKEOFF_KIND_LABELS[kind], kind).toBeTruthy();
    }
    expect(Object.keys(TAKEOFF_KIND_LABELS).sort()).toEqual([...TAKEOFF_KINDS].sort());
  });
});
