import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { DWG_GUIDE_MESSAGE, findConverter } from './lib/backend.ts';
import { ConvertError, convertDwgToDxf, looksLikeDwg, MAX_DWG_BYTES } from './lib/convert.ts';
import { LIBREDWG_DOWNLOAD_URL } from './lib/libredwg.ts';

/** 보안: 로컬 전용 바인딩. 외부 인터페이스에 절대 노출하지 않는다 (NFR-4). */
const HOST = '127.0.0.1';
const PORT = 5321;

const app = new Hono();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 's-cube-server',
    version: '0.0.0',
  }),
);

/**
 * DWG 변환 백엔드(LibreDWG 1순위 / ODA 폴백) 설치 여부 —
 * 미설치면 클라이언트가 설치 안내 모달을 띄운다.
 */
app.get('/api/convert/status', (c) => {
  const converter = findConverter();
  return c.json({
    installed: converter !== null,
    ...(converter !== null ? { backend: converter.backend, path: converter.path } : {}),
    guide: DWG_GUIDE_MESSAGE,
  });
});

/**
 * DWG 업로드 → DXF 텍스트 응답.
 * multipart(필드명 "file") 또는 raw body 모두 수용. 50MB 제한, 60초 타임아웃.
 * 업로드 바이트만 임시폴더 복사본으로 처리하므로 사용자 원본은 무손상.
 */
app.post('/api/convert', async (c) => {
  // Content-Length 선차단 — 대용량 업로드를 본문 수신 전에 거절
  const declaredRaw = c.req.header('content-length');
  if (declaredRaw !== undefined) {
    const declared = Number(declaredRaw);
    if (Number.isFinite(declared) && declared > MAX_DWG_BYTES) {
      return c.json({ code: 'TOO_LARGE', message: 'DWG 파일이 50MB 제한을 초과했습니다.' }, 413);
    }
  }

  const converter = findConverter();
  if (converter === null) {
    return c.json(
      {
        code: 'NOT_INSTALLED',
        message: `DWG 변환 도구가 설치되어 있지 않습니다 — LibreDWG(무료·등록 불필요)를 ${LIBREDWG_DOWNLOAD_URL} 에서 내려받아 설치한 뒤 다시 시도하세요.`,
        guide: DWG_GUIDE_MESSAGE,
        downloadUrl: LIBREDWG_DOWNLOAD_URL,
      },
      503,
    );
  }

  // 업로드 바이트 수신 — multipart 또는 raw. 파일명·경로는 신뢰하지 않는다.
  let bytes: Uint8Array;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const entry = form.get('file');
    if (!(entry instanceof File)) {
      return c.json(
        { code: 'INVALID_INPUT', message: 'multipart 필드 "file"에 DWG 파일을 첨부하세요.' },
        400,
      );
    }
    bytes = new Uint8Array(await entry.arrayBuffer());
  } else {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  }

  if (bytes.byteLength === 0) {
    return c.json({ code: 'INVALID_INPUT', message: '업로드된 파일이 비어 있습니다.' }, 400);
  }
  if (bytes.byteLength > MAX_DWG_BYTES) {
    return c.json({ code: 'TOO_LARGE', message: 'DWG 파일이 50MB 제한을 초과했습니다.' }, 413);
  }
  if (!looksLikeDwg(bytes)) {
    return c.json(
      {
        code: 'INVALID_INPUT',
        message:
          'DWG 형식이 아닙니다 — 올바른 .dwg 파일인지 확인하세요. (DXF는 변환 없이 바로 열 수 있습니다)',
      },
      422,
    );
  }

  try {
    const dxfText = await convertDwgToDxf(bytes, converter);
    return c.text(dxfText, 200, {
      'X-Converted-From': 'dwg',
      'X-Convert-Backend': converter.backend,
    });
  } catch (err) {
    if (err instanceof ConvertError) {
      return c.json({ code: err.code, message: err.message }, err.code === 'TIMEOUT' ? 504 : 422);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ code: 'CONVERT_FAILED', message: `DWG 변환 실패 — ${message}` }, 500);
  }
});

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[s-cube-server] listening on http://${HOST}:${info.port}`);
});
