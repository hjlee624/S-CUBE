/**
 * LibreDWG dwg2dxf 탐지 (FR-1.2 DWG 직접 입력) — 1순위 변환 백엔드.
 * 무료·등록 불필요한 LibreDWG의 dwg2dxf 실행 파일 경로를 찾는다.
 *
 * 탐지 우선순위:
 *   1. 환경변수 SCUBE_DWG2DXF_PATH (exe 경로 또는 폴더)
 *   2. PATH 환경변수의 각 디렉터리 (dwg2dxf.exe / dwg2dxf)
 *   3. 후보 디렉터리 재귀 탐색(깊이 제한 — 글롭 상당):
 *      %USERPROFILE%/tools/libredwg/**, C:/Program Files/LibreDWG/**, C:/tools/libredwg/**
 *
 * 찾은 경로만 캐시한다. 미발견(null)은 캐시하지 않아 사용자가 설치 직후
 * '재시도'하면 서버 재시작 없이 즉시 감지된다 (oda.ts와 동일 정책).
 */

import type { Dirent } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** LibreDWG 릴리스 페이지 — win64 zip 무료 다운로드 (등록 불필요) */
export const LIBREDWG_DOWNLOAD_URL = 'https://github.com/LibreDWG/libredwg/releases';

/** 실행 파일 후보명 — Windows(.exe) 우선, POSIX 무확장 폴백 */
const EXE_NAMES = ['dwg2dxf.exe', 'dwg2dxf'] as const;

/** 후보 디렉터리 재귀 탐색 깊이 제한 — 'LibreDWG/<버전>/bin' 수준까지 커버 */
const SCAN_MAX_DEPTH = 3;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** 디렉터리 직하에서 dwg2dxf 실행 파일 탐색 */
function exeInDir(dir: string): string | null {
  for (const name of EXE_NAMES) {
    const candidate = join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** 환경변수 SCUBE_DWG2DXF_PATH — exe 직접 지정 또는 폴더 지정 모두 허용 */
function fromEnvVar(env: NodeJS.ProcessEnv): string | null {
  const raw = env.SCUBE_DWG2DXF_PATH;
  if (raw === undefined || raw === '') return null;
  if (isFile(raw)) return raw;
  return exeInDir(raw);
}

/** PATH 환경변수의 각 디렉터리에서 실행 파일 탐색 */
function fromPathEnv(env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const exe = exeInDir(dir);
    if (exe !== null) return exe;
  }
  return null;
}

/** 기본 후보 루트 — %USERPROFILE%/tools/libredwg → Program Files → C:/tools */
export function defaultLibredwgRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  const home = env.USERPROFILE ?? env.HOME;
  if (home !== undefined && home !== '') roots.push(join(home, 'tools', 'libredwg'));
  roots.push('C:/Program Files/LibreDWG', 'C:/tools/libredwg');
  return roots;
}

/** 깊이 제한 재귀 탐색 — 'C:/Program Files/LibreDWG/**' 글롭 상당 */
function scanDirRecursive(dir: string, depth: number): string | null {
  const direct = exeInDir(dir);
  if (direct !== null) return direct;
  if (depth === 0) return null;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 루트 자체가 없음 — 다음 후보로
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = scanDirRecursive(join(dir, entry.name), depth - 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * dwg2dxf 탐지 (순수 — 캐시 없음). env·roots 주입으로 단위 테스트한다.
 * 우선순위: SCUBE_DWG2DXF_PATH → PATH → 후보 디렉터리 재귀 탐색.
 */
export function findDwg2dxf(
  env: NodeJS.ProcessEnv = process.env,
  roots: readonly string[] = defaultLibredwgRoots(env),
): string | null {
  const fromEnv = fromEnvVar(env);
  if (fromEnv !== null) return fromEnv;
  const fromPath = fromPathEnv(env);
  if (fromPath !== null) return fromPath;
  for (const root of roots) {
    const found = scanDirRecursive(root, SCAN_MAX_DEPTH);
    if (found !== null) return found;
  }
  return null;
}

let cachedExePath: string | null = null;

/** dwg2dxf 절대 경로 — 미설치면 null (찾은 경로만 캐시, 실존 재확인) */
export function findLibredwgConverter(): string | null {
  if (cachedExePath !== null && isFile(cachedExePath)) return cachedExePath;
  cachedExePath = findDwg2dxf();
  return cachedExePath;
}

/** 테스트·진단용 캐시 초기화 */
export function resetLibredwgCache(): void {
  cachedExePath = null;
}
