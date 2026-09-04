/**
 * DWG 브라우저 변환+파싱 Web Worker (RW-24).
 *
 * @mlightcad/libredwg-web 의 리더(dwg_read_data + convert)로 DWG → DwgDatabase 를 만들고,
 * core dwgDatabaseToDxf 로 표준 DXF 텍스트를 재구성한 뒤, 검증된 parseAndNormalizeDxf 로
 * DrawingModel 을 만든다. (라이브러리의 dwg_write_dxf 는 일부 도면에서 WASM 크래시가 있어
 * 쓰지 않는다 — 리더는 견고하다.)
 *
 * WASM(9.5MB)은 무거우므로 이 워커는 DWG 를 열 때만 동적 로드된다(메인 번들 무영향).
 * .wasm 은 public/libredwg/ 에서 정적 서빙되며, LibreDwg.create('/libredwg') 의 locateFile
 * 이 '/libredwg/libredwg-web.wasm' 로 해석한다.
 */
import { type DwgLikeDatabase, dwgDatabaseToDxf, parseAndNormalizeDxf } from '../lib/core-api.ts';
import type { ParseDwgRequest, ParseResponse } from './messages.ts';

function post(msg: ParseResponse): void {
  (self as unknown as { postMessage: (m: ParseResponse) => void }).postMessage(msg);
}

/** WASM 자산 디렉터리 — public/libredwg/libredwg-web.wasm */
const WASM_DIR = '/libredwg';

self.addEventListener('message', (ev: MessageEvent<ParseDwgRequest>) => {
  const req = ev.data;
  if (req.type !== 'parse-dwg') return;
  void (async () => {
    const started = performance.now();
    try {
      post({ type: 'progress', stage: 'convert', progress: -1 });
      const ab = await req.file.arrayBuffer();

      // 동적 import — WASM 글루는 DWG 열 때만 로드.
      const { LibreDwg, Dwg_File_Type } = await import('@mlightcad/libredwg-web');
      const libredwg = await LibreDwg.create(WASM_DIR);

      const ptr = libredwg.dwg_read_data(ab, Dwg_File_Type.DWG);
      if (ptr === undefined || ptr === null) {
        throw new Error('DWG 데이터를 읽지 못했습니다 (손상되었거나 지원하지 않는 버전)');
      }
      const database = libredwg.convert(ptr);
      // Dwg_Data 는 convert 후 불필요 — 메모리 해제.
      try {
        libredwg.dwg_free(ptr);
      } catch {
        // 해제 실패는 치명적이지 않음(다음 GC/워커 종료로 회수).
      }

      post({ type: 'progress', stage: 'parse', progress: -1 });
      // libredwg 의 DwgDatabase 는 core 의 덕타이핑 DwgLikeDatabase 의 상위집합 — unknown 경유 캐스트.
      const { dxf, skipped, unplacedEntities, unplacedBlockNames } = dwgDatabaseToDxf(
        database as unknown as DwgLikeDatabase,
      );

      post({ type: 'progress', stage: 'normalize', progress: 1 });
      const model = parseAndNormalizeDxf(dxf);

      post({
        type: 'done',
        model,
        elapsed_ms: performance.now() - started,
        skipped,
        unplaced: { count: unplacedEntities, names: unplacedBlockNames },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'error', message });
    }
  })();
});
