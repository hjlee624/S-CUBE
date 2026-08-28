/**
 * 씬 싱글턴 — DrawingModel + R-tree 공간 인덱스 (P1-7).
 *
 * 대용량 배열을 React/Zustand 상태로 두면 비교 비용이 크므로,
 * 렌더러·스냅·히트테스트가 직접 참조하는 모듈 상태로 관리한다.
 * (모델 자체는 store에도 있지만, 인덱스는 여기만)
 */

import type { DrawingModel } from '@s-cube/schema';
import RBush from 'rbush';
import { entityBounds } from '../lib/core-api.ts';

/** R-tree 항목 — 엔티티 배열 인덱스만 보관 */
export interface SceneItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** model.entities 인덱스 */
  i: number;
}

interface Scene {
  model: DrawingModel | null;
  index: RBush<SceneItem> | null;
  /** bounds를 구할 수 없어 인덱스에서 빠진 엔티티 인덱스 — 컬링 없이 항상 그린다 */
  unboundedIndices: number[];
}

export const scene: Scene = {
  model: null,
  index: null,
  unboundedIndices: [],
};

/** 모델 교체 시 인덱스 재구축. bulk load로 O(n log n) */
export function setSceneModel(model: DrawingModel | null): void {
  scene.model = model;
  scene.unboundedIndices = [];
  if (model === null) {
    scene.index = null;
    return;
  }
  const items: SceneItem[] = [];
  for (let i = 0; i < model.entities.length; i++) {
    const e = model.entities[i];
    if (e === undefined) continue;
    const b = entityBounds(e);
    if (b === null) {
      scene.unboundedIndices.push(i);
      continue;
    }
    items.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, i });
  }
  const tree = new RBush<SceneItem>();
  tree.load(items);
  scene.index = tree;
}
