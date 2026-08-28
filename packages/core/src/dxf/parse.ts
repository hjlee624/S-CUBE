/**
 * P1-1: dxf-parser 래핑 — parseSync 호출과 예외의 한국어 재던지기.
 * Node 전용 API를 쓰지 않으므로 브라우저(Web Worker)에서도 동작한다.
 */
import DxfParser from 'dxf-parser';
import type { RawDxf } from './raw-types.ts';

/** DXF 텍스트를 dxf-parser로 파싱. 실패 시 한국어 메시지로 재던진다. */
export function parseDxfRaw(text: string): RawDxf {
  const parser = new DxfParser();
  let result: unknown;
  try {
    result = parser.parseSync(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`DXF 파싱 실패: ${detail}`, { cause: err });
  }
  if (result === null || typeof result !== 'object') {
    throw new Error('DXF 파싱 실패: 파서가 유효한 결과를 반환하지 않았습니다.');
  }
  return result as RawDxf;
}
