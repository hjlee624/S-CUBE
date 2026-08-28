/**
 * DXF 파싱 Web Worker (P1-4) — 읽기 → 파싱 → 정규화 단계별 진행 메시지 송신.
 * 메인 스레드는 진행바만 갱신하고, 완료 시 DrawingModel을 받는다.
 */
import { parseAndNormalizeDxf } from '../lib/core-api.ts';
import type { ParseRequest, ParseResponse } from './messages.ts';

function post(msg: ParseResponse): void {
  // Worker 전역 postMessage
  (self as unknown as { postMessage: (m: ParseResponse) => void }).postMessage(msg);
}

/** File을 스트림으로 읽어 진행률을 보고하며 텍스트로 디코드 */
async function readFileWithProgress(file: File): Promise<string> {
  const total = file.size;
  if (total === 0) return '';
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const parts: string[] = [];
  let readBytes = 0;
  let lastReported = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    readBytes += value.byteLength;
    parts.push(decoder.decode(value, { stream: true }));
    const pct = readBytes / total;
    // 과도한 postMessage 억제 — 2% 단위로만 보고
    if (pct - lastReported >= 0.02) {
      lastReported = pct;
      post({ type: 'progress', stage: 'read', progress: Math.min(pct, 1) });
    }
  }
  parts.push(decoder.decode());
  post({ type: 'progress', stage: 'read', progress: 1 });
  return parts.join('');
}

self.addEventListener('message', (ev: MessageEvent<ParseRequest>) => {
  const req = ev.data;
  if (req.type !== 'parse') return;
  void (async () => {
    const started = performance.now();
    try {
      post({ type: 'progress', stage: 'read', progress: 0 });
      const text = await readFileWithProgress(req.file);

      post({ type: 'progress', stage: 'parse', progress: -1 });
      // 파싱·정규화는 core 단일 호출 — 단계 전환만 보고 (세부 진행률 없음)
      const model = parseAndNormalizeDxf(text);

      post({ type: 'progress', stage: 'normalize', progress: 1 });
      post({ type: 'done', model, elapsed_ms: performance.now() - started });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'error', message });
    }
  })();
});
