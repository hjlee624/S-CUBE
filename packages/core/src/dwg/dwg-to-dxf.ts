/**
 * RW-24: DwgDatabase → DXF ASCII 재구성.
 *
 * 브라우저 WASM(@mlightcad/libredwg-web)의 `dwg_read_data`+`convert()` 는 실도면(횡단면도
 * 포함)을 견고하게 읽지만, 같은 라이브러리의 `dwg_write_dxf`(DXF 라이터)는 일부 도면에서
 * WASM 메모리 오류/무한루프를 일으킨다. 그래서 리더가 만든 DwgDatabase 를 여기서 우리가
 * 직접 표준 DXF 텍스트로 재구성해, 검증된 기존 파이프라인(parseAndNormalizeDxf — 블록 전개·
 * HATCH·정규화·bounds·역추적 handle)에 그대로 투입한다.
 *
 * 설계 원칙:
 * - @mlightcad 타입에 의존하지 않는다(덕 타이핑) — core 는 DWG 라이브러리와 분리.
 * - 각도 단위: DwgDatabase 는 라디안. DXF 그룹 50/51(ARC·TEXT·INSERT 회전)은 도(degree)이므로
 *   변환한다. ELLIPSE 41/42 는 DXF 도 매개변수(라디안) 그대로.
 * - handle(그룹 5)을 보존해 수량 역추적을 유지한다.
 * - 블록: DwgDatabase.tables.BLOCK_RECORD.entries[].entities 를 BLOCKS 섹션으로,
 *   모델공간 엔티티(db.entities)를 ENTITIES 섹션으로 emit → INSERT 는 파이프라인이 전개.
 *
 * v1 지원 엔티티: LINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE, TEXT, MTEXT, SOLID, INSERT.
 * 미지원(HATCH·MULTILEADER·VIEWPORT·WIPEOUT·ATTRIB 등)은 건너뛰고 개수를 집계해 알린다.
 */

const RAD2DEG = 180 / Math.PI;

interface P {
  x: number;
  y: number;
  z?: number;
}

/** 덕 타이핑된 DwgDatabase 부분집합 — 우리가 읽는 필드만 선언 */
export interface DwgLikeEntity {
  type: string;
  handle?: string;
  layer?: string;
  colorIndex?: number;
  [key: string]: unknown;
}
export interface DwgLikeLayer {
  name: string;
  colorIndex?: number;
  color?: number;
  off?: boolean;
  frozen?: boolean;
}
export interface DwgLikeBlockRecord {
  name: string;
  basePoint?: P;
  entities?: DwgLikeEntity[];
}
export interface DwgLikeDatabase {
  entities?: DwgLikeEntity[];
  tables?: {
    LAYER?: { entries?: DwgLikeLayer[] };
    BLOCK_RECORD?: { entries?: DwgLikeBlockRecord[] };
  };
  header?: Record<string, unknown>;
}

/** 변환 결과 — DXF 텍스트 + emit 통계(미지원 형식 집계) */
export interface DwgToDxfResult {
  dxf: string;
  /** emit 한 엔티티 수(모델공간 + 블록) */
  emitted: number;
  /** 미지원으로 건너뛴 형식별 개수 */
  skipped: Record<string, number>;
}

/** 지수표기 회피 숫자 포맷 — 좌표/각도용 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  // 8자리 고정 후 잉여 0 제거 (좌표 ~1e6 에서도 mm 정밀 충분)
  return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pt(v: unknown): P {
  const o = (v ?? {}) as Record<string, unknown>;
  return { x: num(o.x), y: num(o.y), z: num(o.z) };
}

/** DXF 그룹(코드·값) 누적기 */
class DxfWriter {
  private out: string[] = [];
  g(code: number, value: string | number): void {
    this.out.push(String(code));
    this.out.push(typeof value === 'number' ? fmt(value) : value);
  }
  toString(): string {
    return `${this.out.join('\n')}\n`;
  }
}

/** 공통 헤더(0/type, 5/handle, 8/layer, 62/color) emit */
function emitCommon(w: DxfWriter, e: DwgLikeEntity, type: string): void {
  w.g(0, type);
  if (typeof e.handle === 'string' && e.handle !== '') w.g(5, e.handle);
  w.g(8, typeof e.layer === 'string' && e.layer !== '' ? e.layer : '0');
  if (typeof e.colorIndex === 'number' && e.colorIndex !== 256 && e.colorIndex >= 0) {
    w.g(62, e.colorIndex);
  }
}

/** MTEXT 텍스트를 그룹 3(연속)·1(마지막)로 250자 청크 분할 */
function emitMTextString(w: DxfWriter, text: string): void {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 250) chunks.push(text.slice(i, i + 250));
  if (chunks.length === 0) {
    w.g(1, '');
    return;
  }
  for (let i = 0; i < chunks.length - 1; i++) w.g(3, chunks[i] as string);
  w.g(1, chunks[chunks.length - 1] as string);
}

/**
 * 엔티티 하나를 DXF 로 emit. 지원하면 true, 미지원이면 false(호출측이 집계).
 * LWPOLYLINE 폐합: libredwg flag 비트 0x200(512) = closed.
 */
function emitEntity(w: DxfWriter, e: DwgLikeEntity): boolean {
  switch (e.type) {
    case 'LINE': {
      emitCommon(w, e, 'LINE');
      const a = pt(e.startPoint);
      const b = pt(e.endPoint);
      w.g(10, a.x);
      w.g(20, a.y);
      w.g(30, a.z ?? 0);
      w.g(11, b.x);
      w.g(21, b.y);
      w.g(31, b.z ?? 0);
      return true;
    }
    case 'LWPOLYLINE': {
      const verts = Array.isArray(e.vertices) ? (e.vertices as Record<string, unknown>[]) : [];
      if (verts.length === 0) return false;
      emitCommon(w, e, 'LWPOLYLINE');
      w.g(90, verts.length);
      const flag = num(e.flag);
      w.g(70, (flag & 512) !== 0 ? 1 : 0);
      for (const v of verts) {
        w.g(10, num(v.x));
        w.g(20, num(v.y));
        const bulge = num(v.bulge);
        if (bulge !== 0) w.g(42, bulge);
      }
      return true;
    }
    case 'CIRCLE': {
      emitCommon(w, e, 'CIRCLE');
      const c = pt(e.center);
      w.g(10, c.x);
      w.g(20, c.y);
      w.g(40, num(e.radius));
      return true;
    }
    case 'ARC': {
      emitCommon(w, e, 'ARC');
      const c = pt(e.center);
      w.g(10, c.x);
      w.g(20, c.y);
      w.g(40, num(e.radius));
      w.g(50, num(e.startAngle) * RAD2DEG);
      w.g(51, num(e.endAngle) * RAD2DEG);
      return true;
    }
    case 'ELLIPSE': {
      emitCommon(w, e, 'ELLIPSE');
      const c = pt(e.center);
      const major = pt(e.majorAxisEndPoint);
      w.g(10, c.x);
      w.g(20, c.y);
      w.g(30, 0);
      w.g(11, major.x);
      w.g(21, major.y);
      w.g(31, 0);
      w.g(40, num(e.axisRatio, 1));
      // ELLIPSE 41/42 는 DXF 도 라디안 매개변수 그대로.
      w.g(41, num(e.startAngle));
      w.g(42, num(e.endAngle, 2 * Math.PI));
      return true;
    }
    case 'TEXT': {
      emitCommon(w, e, 'TEXT');
      const p = pt(e.startPoint);
      w.g(10, p.x);
      w.g(20, p.y);
      w.g(40, num(e.textHeight, 1));
      w.g(1, typeof e.text === 'string' ? e.text : '');
      const rot = num(e.rotation);
      if (rot !== 0) w.g(50, rot * RAD2DEG);
      return true;
    }
    case 'MTEXT': {
      emitCommon(w, e, 'MTEXT');
      const p = pt(e.insertionPoint);
      w.g(10, p.x);
      w.g(20, p.y);
      w.g(40, num(e.textHeight, 1));
      emitMTextString(w, typeof e.text === 'string' ? e.text : '');
      return true;
    }
    case 'SOLID': {
      emitCommon(w, e, 'SOLID');
      const c1 = pt(e.corner1);
      const c2 = pt(e.corner2);
      const c3 = pt(e.corner3);
      const c4 = pt(e.corner4);
      w.g(10, c1.x);
      w.g(20, c1.y);
      w.g(11, c2.x);
      w.g(21, c2.y);
      w.g(12, c3.x);
      w.g(22, c3.y);
      w.g(13, c4.x);
      w.g(23, c4.y);
      return true;
    }
    case 'INSERT': {
      emitCommon(w, e, 'INSERT');
      const name = typeof e.name === 'string' ? e.name : '';
      if (name === '') return false;
      w.g(2, name);
      const p = pt(e.insertionPoint);
      w.g(10, p.x);
      w.g(20, p.y);
      w.g(30, 0);
      const xs = num(e.xScale, 1);
      const ys = num(e.yScale, 1);
      const zs = num(e.zScale, 1);
      if (xs !== 1) w.g(41, xs);
      if (ys !== 1) w.g(42, ys);
      if (zs !== 1) w.g(43, zs);
      const rot = num(e.rotation);
      if (rot !== 0) w.g(50, rot * RAD2DEG);
      return true;
    }
    default:
      return false;
  }
}

/**
 * DwgDatabase → DXF ASCII 텍스트 (RW-24).
 * 미지원 엔티티는 건너뛰고 result.skipped 에 형식별 개수를 담는다.
 */
export function dwgDatabaseToDxf(db: DwgLikeDatabase): DwgToDxfResult {
  const w = new DxfWriter();
  const skipped: Record<string, number> = {};
  let emitted = 0;
  const emit = (e: DwgLikeEntity): void => {
    if (emitEntity(w, e)) emitted += 1;
    else skipped[e.type] = (skipped[e.type] ?? 0) + 1;
  };

  const insunits = num((db.header ?? {}).INSUNITS, 0);

  // HEADER
  w.g(0, 'SECTION');
  w.g(2, 'HEADER');
  w.g(9, '$ACADVER');
  w.g(1, 'AC1021');
  w.g(9, '$INSUNITS');
  w.g(70, insunits);
  w.g(0, 'ENDSEC');

  // TABLES — LAYER 만(엔티티 layer 문자열 해석·표시용)
  const layers = db.tables?.LAYER?.entries ?? [];
  w.g(0, 'SECTION');
  w.g(2, 'TABLES');
  w.g(0, 'TABLE');
  w.g(2, 'LAYER');
  w.g(70, layers.length);
  for (const ly of layers) {
    w.g(0, 'LAYER');
    w.g(2, ly.name);
    w.g(70, ly.frozen === true ? 1 : 0);
    // off/frozen 레이어는 색 음수로 표기(관례) — 우리 파이프라인이 visible 로 해석.
    const ci = typeof ly.colorIndex === 'number' ? ly.colorIndex : 7;
    w.g(62, ly.off === true ? -Math.abs(ci) : ci);
    w.g(6, 'Continuous');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  // BLOCKS — *Model_Space/*Paper_Space 제외한 실제 블록 정의
  const blockRecords = db.tables?.BLOCK_RECORD?.entries ?? [];
  w.g(0, 'SECTION');
  w.g(2, 'BLOCKS');
  for (const br of blockRecords) {
    const name = br.name ?? '';
    if (name === '' || name.startsWith('*')) continue;
    const ents = Array.isArray(br.entities) ? br.entities : [];
    const base = pt(br.basePoint);
    w.g(0, 'BLOCK');
    w.g(8, '0');
    w.g(2, name);
    w.g(70, 0);
    w.g(10, base.x);
    w.g(20, base.y);
    w.g(30, 0);
    w.g(3, name);
    for (const e of ents) emit(e);
    w.g(0, 'ENDBLK');
    w.g(8, '0');
  }
  w.g(0, 'ENDSEC');

  // ENTITIES — 모델공간
  w.g(0, 'SECTION');
  w.g(2, 'ENTITIES');
  for (const e of db.entities ?? []) emit(e);
  w.g(0, 'ENDSEC');

  w.g(0, 'EOF');

  return { dxf: w.toString(), emitted, skipped };
}
