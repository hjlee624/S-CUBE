/**
 * LibreDWG dwg2dxf 탐지 — env·roots 주입으로 우선순위를 검증한다.
 * 실제 시스템 경로(Program Files 등)는 건드리지 않도록 roots를 항상 명시 주입.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultLibredwgRoots, findDwg2dxf } from './libredwg.ts';

const base = mkdtempSync(join(tmpdir(), 's-cube-libredwg-test-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** dir에 스텁 dwg2dxf.exe 생성 후 exe 경로 반환 */
function makeExe(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, 'dwg2dxf.exe');
  writeFileSync(exe, 'stub');
  return exe;
}

describe('findDwg2dxf 탐지 우선순위', () => {
  it('1순위: SCUBE_DWG2DXF_PATH — exe 직접 지정', () => {
    const exe = makeExe(join(base, 'env-exe'));
    expect(findDwg2dxf({ SCUBE_DWG2DXF_PATH: exe, PATH: '' }, [])).toBe(exe);
  });

  it('1순위: SCUBE_DWG2DXF_PATH — 폴더 지정 시 폴더/dwg2dxf.exe', () => {
    const dir = join(base, 'env-dir');
    const exe = makeExe(dir);
    expect(findDwg2dxf({ SCUBE_DWG2DXF_PATH: dir, PATH: '' }, [])).toBe(exe);
  });

  it('환경변수가 PATH·후보 디렉터리보다 우선한다', () => {
    const envExe = makeExe(join(base, 'prio-env'));
    const pathDir = join(base, 'prio-path');
    makeExe(pathDir);
    const rootDir = join(base, 'prio-root');
    makeExe(rootDir);
    expect(findDwg2dxf({ SCUBE_DWG2DXF_PATH: envExe, PATH: pathDir }, [rootDir])).toBe(envExe);
  });

  it('2순위: PATH의 디렉터리에서 dwg2dxf.exe 탐색 (후보 디렉터리보다 우선)', () => {
    const pathDir = join(base, 'path-dir');
    const pathExe = makeExe(pathDir);
    const rootDir = join(base, 'path-vs-root');
    makeExe(rootDir);
    expect(findDwg2dxf({ PATH: pathDir }, [rootDir])).toBe(pathExe);
  });

  it('3순위: 후보 디렉터리를 재귀 탐색한다 (하위 bin 폴더까지)', () => {
    const root = join(base, 'scan-root');
    const exe = makeExe(join(root, 'libredwg-0.14.0', 'bin'));
    expect(findDwg2dxf({ PATH: '' }, [root])).toBe(exe);
  });

  it('어디에도 없으면 null — 캐시하지 않아 다음 요청에서 재탐지된다', () => {
    const emptyRoot = join(base, 'empty-root');
    mkdirSync(emptyRoot, { recursive: true });
    expect(findDwg2dxf({ PATH: '' }, [emptyRoot])).toBeNull();
  });

  it('환경변수가 존재하지 않는 경로면 다음 순위로 폴백한다', () => {
    const pathDir = join(base, 'fallback-path');
    const pathExe = makeExe(pathDir);
    const missing = join(base, 'no-such-dir', 'dwg2dxf.exe');
    expect(findDwg2dxf({ SCUBE_DWG2DXF_PATH: missing, PATH: pathDir }, [])).toBe(pathExe);
  });
});

describe('defaultLibredwgRoots', () => {
  it('%USERPROFILE%/tools/libredwg 를 첫 후보로, 고정 후보 2곳을 뒤따른다', () => {
    const roots = defaultLibredwgRoots({ USERPROFILE: 'C:/Users/tester' });
    expect(roots[0]).toBe(join('C:/Users/tester', 'tools', 'libredwg'));
    expect(roots).toContain('C:/Program Files/LibreDWG');
    expect(roots).toContain('C:/tools/libredwg');
  });

  it('USERPROFILE이 없으면 HOME을 사용하고, 둘 다 없으면 고정 후보만 남는다', () => {
    expect(defaultLibredwgRoots({ HOME: '/home/tester' })[0]).toBe(
      join('/home/tester', 'tools', 'libredwg'),
    );
    expect(defaultLibredwgRoots({})).toEqual(['C:/Program Files/LibreDWG', 'C:/tools/libredwg']);
  });
});
