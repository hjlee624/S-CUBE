/**
 * DWG 변환 클라이언트 — 순수 분기·파싱 로직 검증 (fetch 불필요).
 */
import { describe, expect, it } from 'vitest';
import {
  convertErrorMessage,
  dxfNameFromDwg,
  parseConvertStatus,
  routeDwgByStatus,
  SERVER_DOWN_MESSAGE,
} from './convert-api.ts';

describe('routeDwgByStatus', () => {
  it('fetch 자체 실패(서버 미기동) → server-down + 고정 안내 문구', () => {
    expect(routeDwgByStatus('network-error')).toEqual({
      kind: 'server-down',
      message: SERVER_DOWN_MESSAGE,
    });
  });

  it('프록시 502/비계약 응답도 server-down으로 간주한다', () => {
    expect(routeDwgByStatus({ ok: false, body: null }).kind).toBe('server-down');
    expect(routeDwgByStatus({ ok: true, body: '<html>Bad Gateway</html>' }).kind).toBe(
      'server-down',
    );
    expect(routeDwgByStatus({ ok: true, body: { unexpected: true } }).kind).toBe('server-down');
  });

  it('installed=true → convert 경로', () => {
    expect(
      routeDwgByStatus({
        ok: true,
        body: { installed: true, path: 'C:/Program Files/ODA/x/ODAFileConverter.exe', guide: 'g' },
      }),
    ).toEqual({ kind: 'convert' });
  });

  it('installed=false → 서버가 준 설치 가이드로 guide 경로', () => {
    expect(
      routeDwgByStatus({ ok: true, body: { installed: false, guide: '설치 안내 문구' } }),
    ).toEqual({ kind: 'guide', guide: '설치 안내 문구' });
  });
});

describe('parseConvertStatus', () => {
  it('계약 필드(installed:boolean, guide:string)를 검증한다', () => {
    expect(parseConvertStatus({ installed: true, guide: 'g', path: 'p' })).toEqual({
      installed: true,
      guide: 'g',
      path: 'p',
    });
    expect(parseConvertStatus({ installed: 'yes', guide: 'g' })).toBeNull();
    expect(parseConvertStatus({ installed: true })).toBeNull();
    expect(parseConvertStatus(null)).toBeNull();
    expect(parseConvertStatus('text')).toBeNull();
  });
});

describe('dxfNameFromDwg', () => {
  it('확장자만 .dxf로 바꾼다 (대소문자 무관, 한글 파일명 유지)', () => {
    expect(dxfNameFromDwg('plan.dwg')).toBe('plan.dxf');
    expect(dxfNameFromDwg('PLAN.DWG')).toBe('PLAN.dxf');
    expect(dxfNameFromDwg('사연댐 단면도.dwg')).toBe('사연댐 단면도.dxf');
  });

  it('확장자가 없으면 .dxf를 부여한다', () => {
    expect(dxfNameFromDwg('plan')).toBe('plan.dxf');
  });
});

describe('convertErrorMessage', () => {
  it('서버가 준 한국어 message를 우선한다', () => {
    expect(convertErrorMessage(422, { code: 'CONVERT_FAILED', message: '버전 호환 안내' })).toBe(
      '버전 호환 안내',
    );
  });

  it('message가 없으면 상태코드별 기본 문구', () => {
    expect(convertErrorMessage(413, null)).toContain('50MB');
    expect(convertErrorMessage(503, null)).toContain('설치');
    expect(convertErrorMessage(504, {})).toContain('시간 초과');
    expect(convertErrorMessage(500, null)).toContain('DXF(ASCII)');
  });
});
