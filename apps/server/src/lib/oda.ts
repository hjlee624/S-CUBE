/**
 * ODA File Converter 탐지 (FR-1.2 DWG 직접 입력) —
 * 무료 ODA File Converter(별도 설치)의 실행 파일 경로를 찾는다.
 *
 * 탐지 우선순위:
 *   1. 환경변수 SCUBE_ODA_PATH (exe 경로 또는 설치 폴더)
 *   2. 'C:/Program Files/ODA/<버전폴더>/ODAFileConverter.exe' (최신 버전 우선)
 *   3. 'C:/Program Files (x86)/ODA/<버전폴더>/ODAFileConverter.exe'
 *   4. PATH 환경변수의 각 디렉터리
 *
 * 찾은 경로는 캐시한다. 미설치(null)는 캐시하지 않아 사용자가 설치 직후
 * '재시도'하면 서버 재시작 없이 즉시 감지된다.
 */
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** ODA File Converter 무료 다운로드 페이지 */
export const ODA_DOWNLOAD_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

/** 미설치 시 클라이언트에 전달하는 한국어 설치 안내 */
export const ODA_GUIDE_MESSAGE =
  '무료 ODA File Converter를 설치하면 DWG를 자동으로 DXF로 변환합니다. ' +
  `1) ${ODA_DOWNLOAD_URL} 에서 Windows용 설치본을 내려받아 ` +
  '2) 기본 경로(C:/Program Files/ODA)에 설치한 뒤 3) 다시 시도하세요. ' +
  '다른 위치에 설치했다면 환경변수 SCUBE_ODA_PATH에 ODAFileConverter.exe 경로를 지정하세요.';

const EXE_NAME = 'ODAFileConverter.exe';
const PROGRAM_FILES_ODA = 'C:/Program Files/ODA';
const PROGRAM_FILES_X86_ODA = 'C:/Program Files (x86)/ODA';

/**
 * 버전 폴더명 자연 정렬 내림차순 — 최신 버전 우선.
 * 사전순이 아닌 숫자 비교(numeric)라서 '…26.4.0' > '…25.12.1' > '…9.1.0'이 보장된다.
 */
export function sortOdaDirsByVersionDesc(names: readonly string[]): string[] {
  return [...names].sort((a, b) =>
    b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' }),
  );
}

/** 환경변수 SCUBE_ODA_PATH — exe 직접 지정 또는 설치 폴더 지정 모두 허용 */
function fromEnv(): string | null {
  const raw = process.env.SCUBE_ODA_PATH;
  if (raw === undefined || raw === '') return null;
  const candidate = raw.toLowerCase().endsWith('.exe') ? raw : join(raw, EXE_NAME);
  return existsSync(candidate) ? candidate : null;
}

/** 'C:/Program Files(및 x86)/ODA/<버전폴더>/ODAFileConverter.exe' 글롭 상당 탐색 */
function scanRoot(root: string): string | null {
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null; // 루트 폴더 자체가 없음 — 다음 후보로
  }
  for (const name of sortOdaDirsByVersionDesc(dirs)) {
    const exe = join(root, name, EXE_NAME);
    if (existsSync(exe)) return exe;
  }
  return null;
}

/** PATH 환경변수의 각 디렉터리에서 실행 파일 탐색 */
function fromPathEnv(): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const exe = join(dir, EXE_NAME);
    if (existsSync(exe)) return exe;
  }
  return null;
}

let cachedExePath: string | null = null;

/** ODAFileConverter.exe 절대 경로 — 미설치면 null */
export function findOdaConverter(): string | null {
  // 찾은 경로만 캐시 — 설치 제거 대비 실존 재확인
  if (cachedExePath !== null && existsSync(cachedExePath)) return cachedExePath;
  cachedExePath =
    fromEnv() ?? scanRoot(PROGRAM_FILES_ODA) ?? scanRoot(PROGRAM_FILES_X86_ODA) ?? fromPathEnv();
  return cachedExePath;
}

/** 테스트·진단용 캐시 초기화 */
export function resetOdaCache(): void {
  cachedExePath = null;
}
