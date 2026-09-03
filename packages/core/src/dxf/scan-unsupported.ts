/**
 * dxf-parser가 핸들러 없이 조용히 버리는 엔티티 타입(HATCH 등)의 사전 집계.
 *
 * dxf-parser 1.1.2는 미지원 타입을 log.warn 후 스킵하므로 파싱 결과만으로는
 * 존재 여부를 알 수 없다. ASCII DXF의 (그룹코드, 값) 쌍 구조를 직접 훑어
 * ENTITIES·BLOCKS 섹션의 미지원 타입을 타입명별로 센다 (P1-2: 조용히 버리지 않기).
 */

/** dxf-parser 1.1.2에 엔티티 핸들러가 등록된 타입 + 구조 마커 */
const PARSER_KNOWN_MARKERS: ReadonlySet<string> = new Set([
  // 파서가 파싱해서 entities에 넣는 타입. 정규화(normalize.ts)에서 NEntity로 흡수되며,
  // 정규화에 실패한 개별 엔티티만 expand.ts가 타입명별로 unsupportedCounts에 집계한다.
  // ELLIPSE·SPLINE 은 RW-15에서 폴리라인 근사로 정규화되므로 여기서 원문 스캔 대상이 아니다
  // (파서가 raw 로 넘겨주고 normalize 가 처리 — 원문 스캔은 파서가 '버리는' 타입 전용).
  'POINT',
  '3DFACE',
  'ARC',
  'ATTDEF',
  'CIRCLE',
  'DIMENSION',
  'ELLIPSE',
  'INSERT',
  'LINE',
  'LWPOLYLINE',
  'MTEXT',
  'POLYLINE',
  'SOLID',
  'SPLINE',
  'TEXT',
  'VERTEX', // POLYLINE 하위 정점
  // 구조 마커
  'SECTION',
  'ENDSEC',
  'BLOCK',
  'ENDBLK',
  'SEQEND',
  'EOF',
]);

/**
 * ENTITIES·BLOCKS 섹션에서 dxf-parser가 버리는 타입을 counts에 누적한다.
 * counts 키는 DXF 타입명 (예: 'HATCH').
 */
export function scanParserDroppedTypes(text: string, counts: Record<string, number>): void {
  const lines = text.split(/\r\n|\r|\n/);
  let section: string | null = null;
  let pendingSectionName = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeLine = lines[i];
    const valueLine = lines[i + 1];
    if (codeLine === undefined || valueLine === undefined) break;
    const code = Number.parseInt(codeLine.trim(), 10);
    const value = valueLine.trim();
    if (pendingSectionName) {
      if (code === 2) section = value;
      pendingSectionName = false;
      continue;
    }
    if (code !== 0) continue;
    if (value === 'SECTION') {
      pendingSectionName = true;
      continue;
    }
    if (value === 'ENDSEC') {
      section = null;
      continue;
    }
    if ((section === 'ENTITIES' || section === 'BLOCKS') && !PARSER_KNOWN_MARKERS.has(value)) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
}
