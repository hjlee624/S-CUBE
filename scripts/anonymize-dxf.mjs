/**
 * RW-20: 실도면 DXF 익명화 파이프라인
 *
 * 사용법:
 *   node scripts/anonymize-dxf.mjs <input.dxf> [output.dxf]
 *   node scripts/anonymize-dxf.mjs CAD/여수로\ 굴착계획\ 평면도.dxf fixtures/anon-yeosuro.dxf
 *
 * 처리 내용:
 *   1. HEADER $LASTSAVEDBY 값 → "ANON"
 *   2. TEXT/MTEXT/ATTRIB/ATTDEF 엔티티의 group code 1/3 텍스트 → 빈 문자열 또는 범주 코드
 *   3. $PROJECTNAME 등 헤더 식별 변수 → "ANON"
 *
 * 좌표·레이어·핸들·선형·색상은 보존한다(기하 테스트 용도).
 */
import fs from 'node:fs';
import path from 'node:path';

const TEXT_ENTITIES = new Set(['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF']);

/** DXF를 라인 쌍으로 파싱해 익명화 후 문자열로 반환한다 */
function anonymize(src) {
  const lines = src.split(/\r?\n/);
  const out = [];

  let inHeader = false;
  let inEntities = false;
  let currentEntity = '';
  let prevCode = '';
  let pendingRedact = false; // 다음 값 라인을 교체해야 함
  let textCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // ─── 섹션 전환 추적
    if (prevCode === '2' && trimmed === 'HEADER') inHeader = true;
    if (prevCode === '2' && trimmed === 'ENTITIES') { inHeader = false; inEntities = true; }
    if (prevCode === '2' && (trimmed === 'BLOCKS' || trimmed === 'OBJECTS' || trimmed === 'EOF')) {
      inHeader = false;
      // BLOCKS 안 TEXT 는 블록 정의이므로 엔티티와 동일하게 처리
      inEntities = trimmed !== 'EOF';
    }

    const code = trimmed;

    // ─── HEADER: 식별 변수 다음 값 교체
    if (inHeader && prevCode === '9') {
      const headerVars = new Set(['$LASTSAVEDBY', '$PROJECTNAME', '$FINGERPRINTGUID', '$VERSIONGUID']);
      if (headerVars.has(trimmed)) {
        pendingRedact = true;
        out.push(raw);
        prevCode = code;
        continue;
      }
    }

    // ─── 엔티티 타입 추적
    if (inEntities && prevCode === '0') {
      currentEntity = trimmed;
    }

    // ─── TEXT 류 엔티티의 group code 1(주 텍스트) 또는 3(추가 텍스트) 다음 값 교체
    if (inEntities && TEXT_ENTITIES.has(currentEntity)) {
      if (trimmed === '1' || trimmed === '3') {
        pendingRedact = true;
        out.push(raw);
        prevCode = code;
        continue;
      }
    }

    // ─── 값 라인 교체
    if (pendingRedact) {
      pendingRedact = false;
      // group code 1/3 값을 빈 카운터 ID로 대체 (길이 0은 일부 파서가 거부하므로 짧은 ID 사용)
      out.push(`ANON_${++textCount}`);
      prevCode = '';
      continue;
    }

    out.push(raw);
    prevCode = code;
  }

  return out.join('\n');
}

// ─── CLI 진입점
const [, , inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error('Usage: node scripts/anonymize-dxf.mjs <input.dxf> [output.dxf]');
  process.exit(1);
}

const inputPath = path.resolve(inputArg);
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const outputPath = outputArg
  ? path.resolve(outputArg)
  : path.join(
      path.dirname(inputPath),
      `anon-${path.basename(inputPath, '.dxf')}.dxf`,
    );

const src = fs.readFileSync(inputPath, 'utf8');
const result = anonymize(src);
fs.writeFileSync(outputPath, result, 'utf8');

console.log(`Anonymized: ${inputPath}`);
console.log(`Output:     ${outputPath}`);
console.log(`Text tokens redacted: ${(result.match(/ANON_\d+/g) ?? []).length}`);
