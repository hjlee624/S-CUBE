/**
 * 스냅 우선순위 선택 테스트 (RW-3) — endpoint > intersection > midpoint > center.
 *
 * findSnap 은 scene(R-tree) 싱글턴에 의존하므로, 여기선 순수 선택 로직
 * (rank·pickBestCandidate)만 검증한다. 세그먼트 교차 수치는 intersection.test.ts 담당.
 */
import type { Vec2 } from '@s-cube/schema';
import { describe, expect, it } from 'vitest';
import { pickBestCandidate, rank, type SnapKind } from './snap.ts';

interface C {
  point: Vec2;
  kind: SnapKind;
  handle: string;
}
const c = (kind: SnapKind, x: number, y: number, handle = 'H'): C => ({
  point: { x, y },
  kind,
  handle,
});

describe('rank', () => {
  it('endpoint > intersection > midpoint > center (작을수록 우선)', () => {
    expect(rank('endpoint')).toBeLessThan(rank('intersection'));
    expect(rank('intersection')).toBeLessThan(rank('midpoint'));
    expect(rank('midpoint')).toBeLessThan(rank('center'));
  });
});

describe('pickBestCandidate', () => {
  const cursor: Vec2 = { x: 0, y: 0 };

  it('끝점이 교점보다 우선 — 교점이 더 가까워도 endpoint 를 고른다', () => {
    // 교점은 커서에 더 가깝고(0.1), 끝점은 더 멀다(0.5). 그래도 우선순위상 endpoint.
    const best = pickBestCandidate([c('intersection', 0.1, 0), c('endpoint', 0.5, 0)], cursor, 1);
    expect(best?.kind).toBe('endpoint');
  });

  it('교점이 중점·중심보다 우선', () => {
    const best = pickBestCandidate(
      [c('center', 0.05, 0), c('midpoint', 0.1, 0), c('intersection', 0.4, 0)],
      cursor,
      1,
    );
    expect(best?.kind).toBe('intersection');
  });

  it('같은 종류면 더 가까운 후보를 고른다', () => {
    const best = pickBestCandidate(
      [c('endpoint', 0.8, 0, 'far'), c('endpoint', 0.2, 0, 'near')],
      cursor,
      1,
    );
    expect(best?.handle).toBe('near');
    expect(best?.point.x).toBeCloseTo(0.2, 12);
  });

  it('반경 밖 후보는 제외 — 반경 안에 아무것도 없으면 null', () => {
    const best = pickBestCandidate([c('endpoint', 5, 0)], cursor, 1);
    expect(best).toBeNull();
  });

  it('반경 경계 안팎 혼재 — 안쪽 후보만 고려', () => {
    // endpoint 는 반경 밖(2.0), intersection 은 반경 안(0.5) → intersection 승
    const best = pickBestCandidate([c('endpoint', 2, 0), c('intersection', 0.5, 0)], cursor, 1);
    expect(best?.kind).toBe('intersection');
  });

  it('후보 없음이면 null', () => {
    expect(pickBestCandidate([], cursor, 1)).toBeNull();
  });
});
