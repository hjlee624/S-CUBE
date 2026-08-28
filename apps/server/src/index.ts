import { serve } from '@hono/node-server';
import { Hono } from 'hono';

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

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[s-cube-server] listening on http://${HOST}:${info.port}`);
});
