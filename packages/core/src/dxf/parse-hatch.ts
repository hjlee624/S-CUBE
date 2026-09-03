/**
 * RW-2: HATCH 경계 파서 — 원문 DXF에서 HATCH 엔티티의 경계 loop를 직접 파싱.
 *
 * dxf-parser 1.1.2는 HATCH 핸들러가 없어 HATCH를 조용히 버린다. 실도면 면적 수량의
 * 대부분이 HATCH이므로, ASCII DXF 텍스트를 직접 훑어 각 HATCH의 경계 경로를 NHatch로
 * 정규화한다(P1-2: 조용히 버리지 않기 — 실패한 HATCH는 unsupported로 남긴다).
 *
 * DXF HATCH 경계 구조(AcDbHatch):
 *  - 91: 경계 path 수
 *  - 각 path: 92(path type flag) — bit0(1)=external, bit1(2)=폴리라인 경계, bit4(16)=outermost
 *    · 폴리라인 경계(92 & 2): 72(has_bulge), 73(is_closed), 93(정점 수),
 *      이어서 10/20(정점) [has_bulge면 42(bulge)] 반복.
 *    · edge-type 경계(92 & 2 == 0): 93(edge 수), edge마다 72(edge type:
 *      1=line, 2=arc, 3=ellipse, 4=spline) + 타입별 데이터.
 *  - path 뒤 97(source object 수) + 330(핸들) 등은 무시.
 *
 * 좌표 위생: 비유한·초과 좌표가 섞인 정점은 파이프라인 sanitize 단계에서 걸러진다.
 * 여기서는 구조 파싱과 근사에 집중하되, 명백히 비유한인 정점은 스킵한다.
 */
import type { Loop, NHatch, PVertex, Vec2 } from '@s-cube/schema';
import { pointInPolygon } from '../geometry/area.ts';
import { sampleArc, sampleEllipse, sampleSpline } from '../geometry/curves.ts';

const DEG_TO_RAD = Math.PI / 180;

/** (그룹코드, 값) 쌍 — 값은 문자열 원본 */
interface Pair {
  code: number;
  value: string;
}

/**
 * HATCH 파싱 결과.
 *
 * 실도면에서 HATCH는 대부분 BLOCKS 섹션의 블록 정의 안에 있고 ENTITIES의 INSERT로
 * 배치된다. 따라서 모델 공간에 직접 있는 HATCH(modelHatches)와 블록별 HATCH
 * (hatchesByBlock: 블록-로컬 좌표)를 분리해 돌려주고, 후자는 expand.ts가 INSERT 변환을
 * 적용해 world 좌표로 전개한다.
 */
export interface HatchParseResult {
  /** ENTITIES 섹션에 직접 있는(모델 공간, 페이퍼 스페이스 제외) HATCH */
  modelHatches: NHatch[];
  /** 블록명 → 그 블록 정의 안의 HATCH[] (블록-로컬 좌표, 미변환) */
  hatchesByBlock: Map<string, NHatch[]>;
  /** 구조 파싱 실패로 loop를 하나도 얻지 못한 HATCH 수 (unsupported로 남긴다) */
  failedCount: number;
  /** 페이퍼 스페이스(67=1) 제외 수 */
  paperSpaceExcludedCount: number;
}

/** ASCII DXF 텍스트를 (그룹코드, 값) 쌍 배열로 (2줄씩). 그룹코드 라인의 선행 공백 허용. */
function toPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeLine = lines[i];
    const valueLine = lines[i + 1];
    if (codeLine === undefined || valueLine === undefined) break;
    const code = Number.parseInt(codeLine.trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: valueLine.trim() });
  }
  return pairs;
}

function num(value: string): number {
  return Number.parseFloat(value);
}

function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/** HATCH 엔티티 하나를 파싱하는 커서 — pairs[start..end) 범위. */
interface HatchCursor {
  pairs: Pair[];
  i: number;
  end: number;
}

function peek(c: HatchCursor): Pair | undefined {
  return c.i < c.end ? c.pairs[c.i] : undefined;
}

/**
 * edge-type 경계의 line edge (72=1): 10/20 start, 11/21 end.
 * 두 점을 반환(끝점 포함). 다음 edge/필드 전까지 소비.
 */
function readLineEdge(c: HatchCursor): Vec2[] {
  let start: Vec2 | null = null;
  let end: Vec2 | null = null;
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    if (p.code === 10) {
      const y = c.pairs[c.i + 1];
      start = { x: num(p.value), y: y?.code === 20 ? num(y.value) : 0 };
      c.i += y?.code === 20 ? 2 : 1;
    } else if (p.code === 11) {
      const y = c.pairs[c.i + 1];
      end = { x: num(p.value), y: y?.code === 21 ? num(y.value) : 0 };
      c.i += y?.code === 21 ? 2 : 1;
    } else break;
  }
  const out: Vec2[] = [];
  if (start !== null) out.push(start);
  if (end !== null) out.push(end);
  return out;
}

/**
 * edge-type 경계의 arc edge (72=2): 10/20 center, 40 radius, 50 start deg, 51 end deg,
 * 73 ccw flag. 점열 근사(끝점 포함) 반환.
 */
function readArcEdge(c: HatchCursor): Vec2[] {
  let center: Vec2 = { x: 0, y: 0 };
  let radius = 0;
  let startDeg = 0;
  let endDeg = 360;
  let ccw = true;
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    if (p.code === 10) {
      const y = c.pairs[c.i + 1];
      center = { x: num(p.value), y: y?.code === 20 ? num(y.value) : 0 };
      c.i += y?.code === 20 ? 2 : 1;
    } else if (p.code === 40) {
      radius = num(p.value);
      c.i += 1;
    } else if (p.code === 50) {
      startDeg = num(p.value);
      c.i += 1;
    } else if (p.code === 51) {
      endDeg = num(p.value);
      c.i += 1;
    } else if (p.code === 73) {
      ccw = num(p.value) !== 0;
      c.i += 1;
    } else break;
  }
  if (!(radius > 0)) return [center];
  return sampleArc(center, radius, startDeg * DEG_TO_RAD, endDeg * DEG_TO_RAD, ccw);
}

/**
 * edge-type 경계의 ellipse edge (72=3): 10/20 center, 11/21 major end(상대), 40 ratio,
 * 50 start deg, 51 end deg, 73 ccw. 점열 근사 반환.
 * (DXF 명세: ellipse edge의 start/end는 도(degree) 단위 파라미터각)
 */
function readEllipseEdge(c: HatchCursor): Vec2[] {
  let center: Vec2 = { x: 0, y: 0 };
  let major: Vec2 = { x: 1, y: 0 };
  let ratio = 1;
  let startDeg = 0;
  let endDeg = 360;
  let ccw = true;
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    if (p.code === 10) {
      const y = c.pairs[c.i + 1];
      center = { x: num(p.value), y: y?.code === 20 ? num(y.value) : 0 };
      c.i += y?.code === 20 ? 2 : 1;
    } else if (p.code === 11) {
      const y = c.pairs[c.i + 1];
      major = { x: num(p.value), y: y?.code === 21 ? num(y.value) : 0 };
      c.i += y?.code === 21 ? 2 : 1;
    } else if (p.code === 40) {
      ratio = num(p.value);
      c.i += 1;
    } else if (p.code === 50) {
      startDeg = num(p.value);
      c.i += 1;
    } else if (p.code === 51) {
      endDeg = num(p.value);
      c.i += 1;
    } else if (p.code === 73) {
      ccw = num(p.value) !== 0;
      c.i += 1;
    } else break;
  }
  let startParam = startDeg * DEG_TO_RAD;
  let endParam = endDeg * DEG_TO_RAD;
  // CW(73=0)면 스윕 방향을 뒤집기 위해 start/end를 교환한다(sampleEllipse는 CCW 스윕).
  if (!ccw) {
    const t = startParam;
    startParam = endParam;
    endParam = t;
  }
  return sampleEllipse(center, major, ratio, startParam, endParam);
}

/**
 * edge-type 경계의 spline edge (72=4): 94 degree, 73 rational, 74 periodic, 95 num knots,
 * 96 num control pts, 40(knots 반복), 42(weights 반복 optional), 10/20(control 반복),
 * 11/21(fit points 반복 optional). de Boor 또는 제어 다각형 근사.
 */
function readSplineEdge(c: HatchCursor): Vec2[] {
  let degree = 3;
  const knots: number[] = [];
  const weights: number[] = [];
  const ctrl: Vec2[] = [];
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    if (p.code === 94) {
      degree = num(p.value);
      c.i += 1;
    } else if (p.code === 73 || p.code === 74 || p.code === 95 || p.code === 96) {
      c.i += 1; // rational/periodic 플래그·knot수·control수 — 배열 길이로 대체하므로 소비만
    } else if (p.code === 40) {
      knots.push(num(p.value));
      c.i += 1;
    } else if (p.code === 42) {
      weights.push(num(p.value));
      c.i += 1;
    } else if (p.code === 10) {
      const y = c.pairs[c.i + 1];
      ctrl.push({ x: num(p.value), y: y?.code === 20 ? num(y.value) : 0 });
      c.i += y?.code === 20 ? 2 : 1;
    } else if (p.code === 11) {
      // fit point — 제어점 근사로 충분하므로 소비만 하고 버린다
      const y = c.pairs[c.i + 1];
      c.i += y?.code === 21 ? 2 : 1;
    } else break;
  }
  const usableKnots = knots.length > 0 ? knots : undefined;
  const usableWeights = weights.length === ctrl.length ? weights : undefined;
  return sampleSpline(ctrl, degree, usableKnots, usableWeights, false);
}

/**
 * edge-type 경계 경로 하나를 읽어 정점열로 근사한다. 93(edge 수)를 이미 읽은 뒤 호출한다.
 * @param edgeCount 93 값
 */
function readEdgePath(c: HatchCursor, edgeCount: number): { vertices: Vec2[]; approx: boolean } {
  const vertices: Vec2[] = [];
  let approx = false;
  for (let e = 0; e < edgeCount; e++) {
    // 각 edge는 72(edge type)로 시작
    const head = peek(c);
    if (head === undefined || head.code !== 72) break;
    const edgeType = num(head.value);
    c.i += 1;
    let pts: Vec2[];
    if (edgeType === 1) {
      pts = readLineEdge(c);
    } else if (edgeType === 2) {
      pts = readArcEdge(c);
      approx = true;
    } else if (edgeType === 3) {
      pts = readEllipseEdge(c);
      approx = true;
    } else if (edgeType === 4) {
      pts = readSplineEdge(c);
      approx = true;
    } else {
      // 미지의 edge type — 이후 파싱 신뢰 불가, 이 path 중단
      break;
    }
    // 연속 edge 사이 끝점=시작점 중복을 제거해 정점열을 잇는다.
    for (const p of pts) {
      const last = vertices[vertices.length - 1];
      if (last !== undefined && last.x === p.x && last.y === p.y) continue;
      vertices.push(p);
    }
  }
  return { vertices, approx };
}

/**
 * 폴리라인 경계 경로 하나를 읽는다. 92 bit1 확인 후, has_bulge(72)·is_closed(73)·정점수(93)를
 * 읽고 이미 소비한 상태에서 호출한다.
 */
function readPolylinePath(c: HatchCursor, hasBulge: boolean, vertexCount: number): PVertex[] {
  const out: PVertex[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const px = peek(c);
    if (px === undefined || px.code !== 10) break;
    const py = c.pairs[c.i + 1];
    const x = num(px.value);
    const y = py?.code === 20 ? num(py.value) : 0;
    c.i += py?.code === 20 ? 2 : 1;
    let bulge = 0;
    if (hasBulge) {
      const b = peek(c);
      if (b !== undefined && b.code === 42) {
        bulge = num(b.value);
        c.i += 1;
      }
    }
    out.push({ p: { x, y }, bulge: Number.isFinite(bulge) ? bulge : 0 });
  }
  return out;
}

/** 경로 소비 후 다음 92(경로 시작)까지 나머지 필드(97/330 등)를 스킵한다. */
function skipToNextPath(c: HatchCursor): void {
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    if (p.code === 92) break; // 다음 경로 시작
    // 75/76/98/450 등 hatch style·seed·gradient — 경계 종료를 알리는 마커면 중단
    if (p.code === 75 || p.code === 76 || p.code === 98 || p.code === 450 || p.code === 470) break;
    c.i += 1;
  }
}

/**
 * 파싱 중간 산출 — 아직 외곽/구멍 분류 전의 경계 loop.
 * (92 path type flag 의 external/outermost bit 는 분류에 쓰지 않으므로 보관하지 않는다.)
 */
interface RawLoop {
  vertices: PVertex[];
}

/**
 * even-odd 포함 깊이로 각 loop 의 중첩 깊이를 구한다.
 *
 * 왜 92(external bit) 대신 포함 깊이인가: DXF 명세상 구멍/섬(island) 경계는 external bit 가
 * 아니라 **홀짝 중첩 깊이**로 갈린다(bit4=outermost 는 다중 외곽 구분용 힌트일 뿐). 예:
 *  - 다중 외곽 filled 영역이 disjoint 하게 여러 개 → 모두 깊이 0(외곽·additive).
 *  - 섬 안의 섬(island-in-island) → 깊이 2 로 다시 채워짐(additive). external bit 기반
 *    분류는 이를 구멍으로 오차감한다.
 *
 * 깊이 = 자신의 대표 정점(정점[0])을 포함하는 **다른** loop 의 수. 짝수=채움(외곽 계열),
 * 홀수=구멍. 대표 정점이 경계 위에 걸치는 퇴화는 pointInPolygon 의 tolerance 로 흡수된다.
 */
function nestingDepth(loops: readonly RawLoop[], idx: number): number {
  const self = loops[idx];
  if (self === undefined) return 0;
  const rep = self.vertices[0];
  if (rep === undefined) return 0;
  let depth = 0;
  for (let j = 0; j < loops.length; j++) {
    if (j === idx) continue;
    const other = loops[j];
    if (other === undefined) continue;
    if (pointInPolygon(rep.p, other.vertices)) depth++;
  }
  return depth;
}

/** 하나의 HATCH 엔티티(커서 범위)를 파싱해 Loop[] 근사. 실패(경로 0개)면 빈 배열. */
function parseHatchLoops(c: HatchCursor): { loops: Loop[]; approx: boolean } {
  const rawLoops: RawLoop[] = [];
  let approx = false;
  let pathCount = 0;
  // 91(경로 수)까지 진행
  while (c.i < c.end) {
    const p = c.pairs[c.i];
    if (p === undefined) break;
    c.i += 1;
    if (p.code === 91) {
      pathCount = num(p.value);
      break;
    }
  }
  if (!(pathCount > 0)) return { loops: [], approx };
  for (let path = 0; path < pathCount && c.i < c.end; path++) {
    // 각 경로는 92(path type flag)로 시작
    let head = peek(c);
    // 92를 만날 때까지 스킵(안전망)
    while (head !== undefined && head.code !== 92 && c.i < c.end) {
      c.i += 1;
      head = peek(c);
    }
    if (head === undefined || head.code !== 92) break;
    const flag = num(head.value);
    c.i += 1;
    const isPolyline = (flag & 2) === 2;
    let vertices: PVertex[];
    if (isPolyline) {
      // 폴리라인 경계: 72(has_bulge), 73(is_closed), 93(정점 수)
      let hasBulge = false;
      let vertexCount = 0;
      while (c.i < c.end) {
        const q = peek(c);
        if (q === undefined) break;
        if (q.code === 72) {
          hasBulge = num(q.value) !== 0;
          c.i += 1;
        } else if (q.code === 73) {
          c.i += 1; // is_closed — HATCH 경계는 항상 폐합 취급
        } else if (q.code === 93) {
          vertexCount = num(q.value);
          c.i += 1;
          break;
        } else break;
      }
      vertices = readPolylinePath(c, hasBulge, vertexCount);
    } else {
      // edge-type 경계: 93(edge 수)
      let edgeCount = 0;
      while (c.i < c.end) {
        const q = peek(c);
        if (q === undefined) break;
        if (q.code === 93) {
          edgeCount = num(q.value);
          c.i += 1;
          break;
        }
        c.i += 1;
      }
      const res = readEdgePath(c, edgeCount);
      if (res.approx) approx = true;
      vertices = res.vertices.map((p) => ({ p, bulge: 0 }));
    }
    // 이 경로 뒤 잔여 필드(97/330 등) 스킵
    skipToNextPath(c);
    // 정점 위생: 비유한 제거
    const clean = vertices.filter((v) => isFiniteVec(v.p));
    if (clean.length >= 2) {
      rawLoops.push({ vertices: clean });
    }
  }
  if (rawLoops.length === 0) return { loops: [], approx };
  // even-odd 포함 깊이로 외곽(짝수=채움)·구멍(홀수) 분류 — 92 external bit 대신 명세 규칙.
  // 단일 loop 는 깊이 0 → 외곽. 어느 loop 도 다른 loop 를 포함하지 않으면(disjoint 다중 외곽)
  // 모두 깊이 0 → 전부 외곽. 섬-속-섬은 깊이 2 → 다시 외곽(additive)이 되어 오차감을 막는다.
  const loops: Loop[] = rawLoops.map((raw, idx) => ({
    vertices: raw.vertices,
    isOuter: nestingDepth(rawLoops, idx) % 2 === 0,
  }));
  return { loops, approx };
}

/**
 * ASCII DXF 텍스트에서 모든 HATCH 엔티티를 파싱해 NHatch로 근사한다.
 *
 * - ENTITIES 섹션의 HATCH → modelHatches (페이퍼 스페이스 67=1 은 제외).
 * - BLOCKS 섹션의 HATCH → hatchesByBlock[블록명] (블록-로컬 좌표, INSERT 전개 대상).
 * - 구조 파싱에 실패해 loop를 얻지 못한 HATCH는 failedCount로 집계한다(P1-2).
 */
export function parseHatchEntities(text: string): HatchParseResult {
  const pairs = toPairs(text);
  const modelHatches: NHatch[] = [];
  const hatchesByBlock = new Map<string, NHatch[]>();
  let failedCount = 0;
  let paperSpaceExcludedCount = 0;

  let section: string | null = null;
  let pendingSectionName = false;
  let currentBlock: string | null = null;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p === undefined) continue;
    if (pendingSectionName) {
      if (p.code === 2) section = p.value;
      pendingSectionName = false;
      continue;
    }
    if (p.code === 0 && p.value === 'SECTION') {
      pendingSectionName = true;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      section = null;
      currentBlock = null;
      continue;
    }
    // BLOCK 시작 → 블록명(그룹코드 2) 추적. ENDBLK → 블록 컨텍스트 종료.
    if (section === 'BLOCKS' && p.code === 0 && p.value === 'BLOCK') {
      currentBlock = null;
      for (let j = i + 1; j < pairs.length; j++) {
        const q = pairs[j];
        if (q === undefined || q.code === 0) break;
        if (q.code === 2) {
          currentBlock = q.value;
          break;
        }
      }
      continue;
    }
    if (section === 'BLOCKS' && p.code === 0 && p.value === 'ENDBLK') {
      currentBlock = null;
      continue;
    }
    if (p.code !== 0 || p.value !== 'HATCH') continue;
    const inEntities = section === 'ENTITIES';
    const inBlock = section === 'BLOCKS' && currentBlock !== null;
    if (!inEntities && !inBlock) continue;

    // HATCH 엔티티 범위: 다음 0/* 까지
    let end = i + 1;
    while (end < pairs.length && pairs[end]?.code !== 0) end++;
    // 공통 필드 수집 (layer/color/handle/paperspace)
    let layer = '0';
    let handle = '';
    let colorIndex: number | undefined;
    let inPaper = false;
    for (let j = i + 1; j < end; j++) {
      const q = pairs[j];
      if (q === undefined) continue;
      if (q.code === 8) layer = q.value;
      else if (q.code === 5) handle = q.value;
      else if (q.code === 62) colorIndex = Number.parseInt(q.value, 10);
      else if (q.code === 67) inPaper = q.value.trim() === '1';
    }
    if (inEntities && inPaper) {
      paperSpaceExcludedCount++;
      i = end - 1;
      continue;
    }
    const cursor: HatchCursor = { pairs, i: i + 1, end };
    const { loops } = parseHatchLoops(cursor);
    if (loops.length === 0) {
      failedCount++;
    } else {
      const hatch: NHatch = { kind: 'hatch', handle, layer, loops };
      if (colorIndex !== undefined && Number.isFinite(colorIndex)) hatch.colorIndex = colorIndex;
      if (inBlock && currentBlock !== null) {
        const arr = hatchesByBlock.get(currentBlock);
        if (arr === undefined) hatchesByBlock.set(currentBlock, [hatch]);
        else arr.push(hatch);
      } else {
        modelHatches.push(hatch);
      }
    }
    i = end - 1;
  }

  return { modelHatches, hatchesByBlock, failedCount, paperSpaceExcludedCount };
}
