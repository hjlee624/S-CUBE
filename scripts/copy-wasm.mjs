/**
 * RW-24: libredwg-web WASM 을 apps/web/public/libredwg/ 로 복사한다.
 *
 * 9.5MB WASM 을 저장소에 커밋하지 않고(gitignore), dev/build 직전에 node_modules 에서
 * public 으로 복사해 정적 서빙한다. DWG 워커의 LibreDwg.create('/libredwg') 가
 * '/libredwg/libredwg-web.wasm' 로 로드한다.
 *
 * cwd 와 무관하게 동작: 이 스크립트 위치(scripts/)에서 repo 루트를 유도하고,
 * apps/web 기준으로 패키지를 resolve 한다(pnpm 심링크 대응).
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsDir);
const webDir = join(repoRoot, 'apps', 'web');

// apps/web 기준으로 패키지 resolve (root 에는 심링크만 있을 수 있음).
const requireFromWeb = createRequire(pathToFileURL(join(webDir, 'package.json')));
let pkgWasm;
try {
  // main(dist/*.cjs) → 패키지 루트 → wasm/libredwg-web.wasm
  const main = requireFromWeb.resolve('@mlightcad/libredwg-web');
  const pkgRoot = dirname(dirname(main));
  pkgWasm = join(pkgRoot, 'wasm', 'libredwg-web.wasm');
} catch (err) {
  console.error('[copy-wasm] @mlightcad/libredwg-web 를 찾지 못했습니다:', err.message);
  process.exit(0); // 설치 전이면 조용히 통과(빌드 자체는 막지 않음)
}

if (!existsSync(pkgWasm)) {
  console.error(`[copy-wasm] WASM 파일이 없습니다: ${pkgWasm}`);
  process.exit(0);
}

const destDir = join(webDir, 'public', 'libredwg');
const dest = join(destDir, 'libredwg-web.wasm');
mkdirSync(destDir, { recursive: true });
cpSync(pkgWasm, dest);
console.log(`[copy-wasm] ${pkgWasm} → ${dest}`);
