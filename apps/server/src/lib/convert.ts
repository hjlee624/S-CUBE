/**
 * DWG→DXF 변환 실행기 (FR-1.2) — ODA File Converter CLI를 임시폴더에서 구동한다.
 *
 * 보안 원칙: 사용자 파일명·경로는 절대 신뢰하지 않는다. 업로드 바이트만 받아
 * os.tmpdir() 하위 고유 임시폴더의 고정 이름(input.dwg)으로 기록하고,
 * 변환 후 임시폴더 전체를 제거한다(finally). 사용자 원본 파일은 서버 디스크에
 * 존재하지 않으므로 무손상이 구조적으로 보장된다.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 업로드 크기 제한 50MB */
export const MAX_DWG_BYTES = 50 * 1024 * 1024;

/** 변환 제한 시간 60초 */
export const CONVERT_TIMEOUT_MS = 60_000;

export type ConvertErrorCode = 'CONVERT_FAILED' | 'TIMEOUT';

/** 변환 실패 — 유형(code)별로 HTTP 응답을 분기한다 */
export class ConvertError extends Error {
  readonly code: ConvertErrorCode;

  constructor(code: ConvertErrorCode, message: string) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
  }
}

/**
 * DWG 매직 검사 — 모든 DWG는 'AC10xx' 형태의 버전 문자열로 시작한다
 * (예: AC1032 = AutoCAD 2018). ASCII DXF는 그룹코드 '  0'으로 시작하므로 걸러진다.
 */
export function looksLikeDwg(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x41 /* 'A' */ && bytes[1] === 0x43; /* 'C' */
}

/**
 * ODAFileConverter CLI 인자 — 알려진 공식 시그니처(ODA 문서 기준):
 *   ODAFileConverter <inputDir> <outputDir> <outVer> <outType> <recurse> <audit> [inputFilter]
 * - outVer  "ACAD2018": 산출 DXF 스키마 버전 — core 파서가 소비하는 최신 안정 포맷
 * - outType "DXF"     : ASCII DXF 산출
 * - recurse "0"       : 입력 폴더 하위 미탐색
 * - audit   "1"       : 변환 전 복구 감사(손상 도면 보정) 수행
 * - filter  "*.DWG"   : 입력 폴더에서 DWG만 대상
 */
export function buildConverterArgs(inputDir: string, outputDir: string): string[] {
  return [inputDir, outputDir, 'ACAD2018', 'DXF', '0', '1', '*.DWG'];
}

/** promisify(execFile)의 timeout 강제 종료 여부 판별 */
function isTimeoutError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const rec = err as Record<string, unknown>;
  return rec.killed === true || typeof rec.signal === 'string';
}

/** ODA는 실패 시 출력 폴더에 <이름>.err 텍스트를 남긴다 — 첫 줄을 진단에 활용 */
async function readErrDetail(outputDir: string): Promise<string> {
  try {
    const names = await readdir(outputDir);
    const errName = names.find((n) => n.toLowerCase().endsWith('.err'));
    if (errName === undefined) return '';
    const text = await readFile(join(outputDir, errName), 'utf-8');
    const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
    return firstLine.trim().slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * DWG 바이트 → DXF 텍스트 변환.
 * 임시 in/out 폴더 구성 → CLI 실행(60초 제한) → 산출 DXF 읽기 → 임시폴더 정리(finally).
 */
export async function convertDwgToDxf(dwgBytes: Uint8Array, exePath: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 's-cube-dwg-'));
  const inputDir = join(workDir, 'in');
  const outputDir = join(workDir, 'out');
  try {
    await mkdir(inputDir);
    await mkdir(outputDir);
    // 사용자 파일명 미사용 — 경로 조작 원천 차단
    await writeFile(join(inputDir, 'input.dwg'), dwgBytes);

    try {
      await execFileAsync(exePath, buildConverterArgs(inputDir, outputDir), {
        timeout: CONVERT_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new ConvertError(
          'TIMEOUT',
          'DWG 변환 시간 초과(60초) — 파일이 매우 크거나 변환이 멈췄습니다. CAD에서 DXF(ASCII)로 저장 후 사용을 권장합니다.',
        );
      }
      // 종료코드 비정상이어도 산출물이 있으면 사용 — 아래에서 산출물 부재 시 실패 처리
    }

    let dxfText: string;
    try {
      dxfText = await readFile(join(outputDir, 'input.dxf'), 'utf-8');
    } catch {
      const detail = await readErrDetail(outputDir);
      const base =
        'DWG 변환 실패 — 지원하지 않는 DWG 버전이거나 파일이 손상되었을 수 있습니다. CAD에서 DWG 2018 이하 버전으로 다시 저장하거나 DXF(ASCII)로 내보낸 후 사용하세요.';
      throw new ConvertError('CONVERT_FAILED', detail !== '' ? `${base} (ODA: ${detail})` : base);
    }
    if (dxfText.length === 0) {
      throw new ConvertError('CONVERT_FAILED', 'DWG 변환 실패 — 산출된 DXF가 비어 있습니다.');
    }
    return dxfText;
  } finally {
    // 임시폴더 정리 — 실패해도 응답을 막지 않는다
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // 정리 실패는 무시 (OS 임시폴더 정책에 위임)
    }
  }
}
