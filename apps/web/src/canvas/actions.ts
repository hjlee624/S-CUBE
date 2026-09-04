/**
 * 캔버스 명령 — Zoom Extents (P1-9), 치수 픽킹 (P1-12), 측정 픽킹 (P2-6).
 * UI 컴포넌트·단축키 핸들러가 호출한다.
 */
import type { Bounds, NEntity, Vec2 } from '@s-cube/schema';
import { checkDimension } from '../lib/calibration.ts';
import { distancePointToPolyline, entityBounds, mergeBounds } from '../lib/core-api.ts';
import { buildMeasurement } from '../lib/measure.ts';
import {
  computeSectionAreas,
  extractProfileVertices,
  formatSectionToast,
  planSectionAssignments,
  resolveActiveStation,
} from '../lib/section-area.ts';
import { useAppStore } from '../store/index.ts';
import { overlay } from './overlay-state.ts';
import { hitTestEntity, holeHandlesOf, type PickHit, pickBest, rawMeasureOf } from './pick.ts';
import { scene } from './scene.ts';
import type { CanvasSize } from './transform.ts';
import { fitBoundsViewport } from './transform.ts';

/** 전체 도면 화면맞춤. size 미지정 시 렌더러가 보고한 캔버스 크기 사용 */
export function zoomToExtents(size?: CanvasSize): void {
  const s = useAppStore.getState();
  const bounds = s.model?.bounds ?? null;
  if (bounds === null) return;
  const target = size ?? { width: overlay.canvasWidth, height: overlay.canvasHeight };
  if (target.width <= 0 || target.height <= 0) return;
  s.setViewport(fitBoundsViewport(bounds, target));
}

/**
 * 치수 대조 픽킹 — 커서 주변에서 가장 가까운 DIMENSION을 찾아 대조 실행.
 * @param pickRadius_px 화면 px 허용 반경
 */
export function pickDimensionAt(worldPos: Vec2, pickRadius_px = 12): void {
  const s = useAppStore.getState();
  const model = s.model;
  const cal = s.calibration;
  if (model === null || cal === null || scene.index === null) return;
  const r_world = pickRadius_px / s.viewport.pxPerUnit;
  const hits = scene.index.search({
    minX: worldPos.x - r_world,
    minY: worldPos.y - r_world,
    maxX: worldPos.x + r_world,
    maxY: worldPos.y + r_world,
  });
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined || e.kind !== 'dimension') continue;
    const b = entityBounds(e);
    if (b === null) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const d = Math.hypot(cx - worldPos.x, cy - worldPos.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = hit.i;
    }
  }
  if (bestIdx < 0) {
    s.showToast('근처에 치수(DIMENSION)가 없습니다', 'info');
    return;
  }
  const dim = model.entities[bestIdx];
  if (dim === undefined || dim.kind !== 'dimension') return;
  s.setDimCheck(checkDimension(dim, cal.scale));
}

/** 측정 픽킹 기본 허용거리 (화면 px, 줌 무관 — world로 환산해 판정) */
const MEASURE_TOLERANCE_PX = 8;

/**
 * 측정 픽킹 (P2-6) — 클릭 world점 → R-tree 후보축소 → 정밀 판정 → Measurement 생성.
 *
 * 면적/연장 자동 판별은 hitTestEntity(엔티티 종류)로 결정한다. 캘리브레이션 축척 적용
 * (면적 scale²·연장 scale)은 buildMeasurement(lib/measure.ts)에서 1회만.
 * Shift=true면 다중선택에 추가만 하지 않고 기존 측정 목록에 계속 쌓인다(각 클릭이 1측정).
 *
 * 캘리브레이션 없으면 측정 차단 — 도구 자체가 비활성이지만 이중 안전장치.
 */
export function pickMeasureAt(worldPos: Vec2, additive = false): void {
  const s = useAppStore.getState();
  const model = s.model;
  const cal = s.calibration;
  if (model === null || cal === null || scene.index === null || s.activeId === null) return;

  const tol_world = MEASURE_TOLERANCE_PX / s.viewport.pxPerUnit;
  const hits = scene.index.search({
    minX: worldPos.x - tol_world,
    minY: worldPos.y - tol_world,
    maxX: worldPos.x + tol_world,
    maxY: worldPos.y + tol_world,
  });

  const candidates: PickHit[] = [];
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined) continue;
    const picked = hitTestEntity(e, hit.i, worldPos, tol_world);
    if (picked !== null) candidates.push(picked);
  }

  const best = pickBest(candidates, (h) => {
    // 포함 히트 간 우열: 면적 히트는 rawMeasureOf 면적(작을수록 안쪽), 연장 히트는 무한대(후순위)
    const raw = rawMeasureOf(h);
    return raw.kind === 'area' ? Math.abs(raw.rawValue) : Number.POSITIVE_INFINITY;
  });

  if (best === null) {
    s.showToast('근처에서 측정할 객체를 찾지 못했습니다', 'info');
    return;
  }

  const raw = rawMeasureOf(best);

  // 신뢰성 경고 (2-C) — 측정은 진행하되 사용자에게 알린다.
  if (raw.kind === 'area' && raw.openGap !== null) {
    s.showToast(
      `폐합되지 않은 폴리라인 — 시점·종점을 직선 폐합해 면적 산출 (오차 ${raw.openGap.toPrecision(4)} 도면단위)`,
      'warn',
    );
  } else if (raw.zeroArea) {
    s.showToast('면적이 0입니다 — 퇴화하거나 폐합되지 않은 도형일 수 있습니다', 'warn');
  } else if (raw.selfIntersecting) {
    s.showToast('자기교차 폴리라인 — 면적 값이 부정확할 수 있습니다', 'warn');
  } else if (best.method === 'dimension' && best.entity.kind === 'dimension') {
    if (best.entity.textOverride !== null) {
      s.showToast('치수 텍스트가 override됨 — 실측값(measuredRaw)으로 측정합니다', 'warn');
    }
  }

  const holes = best.entity.kind === 'hatch' ? holeHandlesOf(best.entity) : [];

  const measurement = buildMeasurement(
    {
      id: crypto.randomUUID(),
      drawingId: s.activeId,
      kind: raw.kind,
      rawValue: raw.rawValue,
      method: best.method,
      sourceHandles: [best.handle],
      holes,
      // 기본 명명: 종류 + 짧은 handle (사용자가 패널에서 인라인 편집)
      label: `${raw.kind === 'area' ? '면적' : '연장'} ${best.handle}`,
      createdAt: new Date().toISOString(),
    },
    cal.scale,
  );

  // additive(Shift): 이번 측정을 기존 선택에 누적. 일반 클릭: 새 측정을 단일 선택으로 교체.
  // addMeasurement가 내부적으로 단일선택으로 덮으므로, additive면 병합된 선택으로 한 번 더 확정한다
  // (기존 선택을 덮기 전에 캡처).
  const priorSelection = s.selectedMeasurementIds;
  s.addMeasurement(measurement);
  if (additive) {
    useAppStore.setState({ selectedMeasurementIds: [...priorSelection, measurement.id] });
  }

  // RW-22: 면적 대상 셀이 지정돼 있으면 이 면적을 측점 셀에 자동 기입/누적한다.
  // 반자동 핵심 — 사람은 도면 영역만 클릭, 면적 산정·축척²·셀 기입은 도구가 수행.
  // 일반 클릭 = 이 영역으로 교체, Shift+클릭 = 기존 값에 누적(여러 폐합영역 합산).
  if (raw.kind === 'area' && s.activeStationId !== null && s.activeItemKey !== null) {
    const res = s.acquireAreaIntoCell({
      anchorSectionId: s.activeStationId,
      itemKey: s.activeItemKey,
      area_m2: measurement.value,
      measurementId: measurement.id,
      additive,
    });
    // 경고(비폐합·0·자기교차)가 없을 때만 성공 토스트로 결과를 알린다(경고는 유지).
    const areaClean = raw.openGap === null && !raw.zeroArea && !raw.selfIntersecting;
    if (res !== null && areaClean) {
      s.showToast(
        res.sourceCount > 1
          ? `${s.activeItemKey} 누적 ${res.total_m2.toFixed(2)}㎡ (${res.sourceCount}영역 합산)`
          : `${s.activeItemKey} ${res.total_m2.toFixed(2)}㎡ 자동 기입 · Shift+클릭으로 영역 누적`,
        'success',
      );
    }
  }
}

/** 단면적 취득 프로파일 픽킹 허용거리 (화면 px) — 선(line·open polyline) 근접 판정. */
const SECTION_PICK_TOLERANCE_PX = 8;

/**
 * 커서 근처에서 프로파일(선) 엔티티 하나를 고른다 (순수하지 않음: scene R-tree 사용).
 *
 * 원지반선·계획선은 열린 폴리라인/라인이므로, 면적 도형이 아니라 **경계 근접 거리**가 가장
 * 가까운 line·polyline 을 고른다(성능경로 R-tree 유지). arc·circle·hatch·text·dimension 은 제외.
 */
function pickProfileEntity(worldPos: Vec2, tol_world: number): NEntity | null {
  const s = useAppStore.getState();
  const model = s.model;
  if (model === null || scene.index === null) return null;
  const hits = scene.index.search({
    minX: worldPos.x - tol_world,
    minY: worldPos.y - tol_world,
    maxX: worldPos.x + tol_world,
    maxY: worldPos.y + tol_world,
  });
  let best: NEntity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    const e = model.entities[hit.i];
    if (e === undefined) continue;
    if (e.kind !== 'line' && e.kind !== 'polyline') continue;
    const verts =
      e.kind === 'line'
        ? [
            { p: e.a, bulge: 0 },
            { p: e.b, bulge: 0 },
          ]
        : e.vertices;
    const d = distancePointToPolyline(worldPos, verts, e.kind === 'polyline' ? e.closed : false);
    if (d <= tol_world && d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 단면적 취득 (P3-13) — 반자동 2클릭 흐름.
 *
 * (1) 원지반선 클릭: 프로파일 정점열·handle 을 pendingSectionGround 에 보관하고 안내.
 * (2) 계획선 클릭: 두 프로파일 정점열 → areaBetweenProfiles(도면 단위²) → 축척²(scale²)
 *     적용(㎡) → cut→'절토'·fill→'성토' Measurement(profile-cut-fill) 생성 → 활성 측점 단면에
 *     자동 생성/갱신(assignMeasurementToSection·addSection). 결과·경고 토스트 후 상태 초기화.
 *
 * 캘리브레이션·활성 측점 미충족 시 차단(도구 자체가 캘리브레이션 필수라 1차 방어됨).
 */
export function pickSectionProfileAt(worldPos: Vec2): void {
  const s = useAppStore.getState();
  const model = s.model;
  const cal = s.calibration;
  if (model === null || cal === null || scene.index === null || s.activeId === null) return;

  const tol_world = SECTION_PICK_TOLERANCE_PX / s.viewport.pxPerUnit;
  const picked = pickProfileEntity(worldPos, tol_world);
  if (picked === null) {
    s.showToast('근처에서 선(원지반선·계획선)을 찾지 못했습니다', 'info');
    return;
  }
  const vertices = extractProfileVertices(picked);
  if (vertices === null) {
    s.showToast('이 객체는 프로파일(선)이 아니라 단면적 취득에 쓸 수 없습니다', 'warn');
    return;
  }

  // 1단계: 원지반선 선택 → 보관 + 안내. (활성 측점 검사는 2단계 계산 직전에 한다.)
  if (s.pendingSectionGround === null) {
    s.setPendingSectionGround({ handle: picked.handle, vertices });
    s.showToast('원지반선 선택됨 — 이제 계획선을 클릭하세요', 'info');
    return;
  }

  // 2단계: 계획선 선택. 같은 선을 두 번 클릭하면 되돌린다(오조작 방지).
  const ground = s.pendingSectionGround;
  if (picked.handle === ground.handle) {
    s.showToast('원지반선과 다른 선(계획선)을 클릭하세요', 'warn');
    return;
  }

  // 활성 측점 확인 — 없으면 계산하지 않고 안내(1단계 선택은 유지해 재시도 가능).
  const station = resolveActiveStation(s.sections, s.activeStationId);
  if (station === null) {
    s.showToast('측점을 먼저 추가/선택하세요 — 측점 표에서 대상 행을 고르면 됩니다', 'warn');
    return;
  }

  const result = computeSectionAreas(ground.vertices, vertices, cal.scale);
  const now = new Date().toISOString();
  const plan = planSectionAssignments({
    station,
    drawingId: s.activeId,
    groundHandle: ground.handle,
    designHandle: picked.handle,
    result,
    scale_mPerUnit: cal.scale,
    sections: s.sections,
    stationLabel: station.raw,
    createdAt: now,
    cutMeasurementId: crypto.randomUUID(),
    fillMeasurementId: crypto.randomUUID(),
    cutSectionId: crypto.randomUUID(),
    fillSectionId: crypto.randomUUID(),
  });

  // 부수효과: 측정 생성 → 단면 생성/갱신. (store 순수전이 호출은 오케스트레이터 책임.)
  for (const m of plan.measurements) s.addMeasurement(m);
  for (const w of plan.writes) {
    if (w.op === 'create') s.addSection(w.section);
    else s.assignMeasurementToSection(w.sectionId, w.measurementId, w.area_m2);
  }

  // 1단계 선택 해제(다음 취득 준비). 결과·경고를 하나의 토스트로 합친다.
  // (토스트는 단일 슬롯이라 결과+경고를 따로 호출하면 뒤 호출이 앞 호출을 덮어 값이 안 보인다.)
  s.setPendingSectionGround(null);
  const hasWarnings = result.warnings.length > 0;
  const baseMessage =
    plan.measurements.length === 0
      ? `${station.raw} 절토·성토 단면적이 0 입니다 — 두 선의 위치를 확인하세요`
      : formatSectionToast(station.raw, result);
  const message = hasWarnings
    ? `${baseMessage} · 경고: ${result.warnings.join(' / ')}`
    : baseMessage;
  const tone = hasWarnings || plan.measurements.length === 0 ? 'warn' : 'success';
  s.showToast(message, tone);
}

/**
 * 측정 항목 → 원본 객체 역추적 (P2-11) — 해당 측정의 sourceHandles 경계로 줌+선택 하이라이트.
 * 활성 도면의 측정만 대상(handle이 현재 model에 있어야 함).
 */
export function zoomToMeasurement(measurementId: string, size?: CanvasSize): void {
  const s = useAppStore.getState();
  const model = s.model;
  if (model === null) return;
  const m = s.measurements.find((x) => x.id === measurementId);
  if (m === undefined || m.drawingId !== s.activeId) return;

  const handleSet = new Set(m.sourceHandles);
  const boundsList: (Bounds | null)[] = [];
  for (const e of model.entities) {
    if (handleSet.has(e.handle)) boundsList.push(entityBounds(e));
  }
  const merged = mergeBounds(boundsList);

  // 선택 하이라이트 (역추적 시 단일 선택으로)
  s.selectMeasurement(measurementId);

  if (merged === null) return;
  const target = size ?? { width: overlay.canvasWidth, height: overlay.canvasHeight };
  if (target.width <= 0 || target.height <= 0) return;
  // 대상이 화면의 절반 정도를 채우도록 여백을 크게 줘 컨텍스트를 남긴다.
  const padded: Bounds = {
    minX: merged.minX,
    minY: merged.minY,
    maxX: merged.maxX,
    maxY: merged.maxY,
  };
  s.setViewport(fitBoundsViewport(padded, target, Math.min(target.width, target.height) * 0.28));
}

/** 측정 하이라이트 대상 handle 집합 — 렌더러가 참조 (선택된 측정들의 sourceHandles 합집합) */
export function selectedMeasurementHandles(): Set<string> {
  const s = useAppStore.getState();
  const active = new Set(s.measurements.filter((m) => m.drawingId === s.activeId).map((m) => m.id));
  const handles = new Set<string>();
  for (const id of s.selectedMeasurementIds) {
    if (!active.has(id)) continue;
    const m = s.measurements.find((x) => x.id === id);
    if (m === undefined) continue;
    for (const h of m.sourceHandles) handles.add(h);
  }
  return handles;
}
