/**
 * DWG→DXF 변환 API 클라이언트 (FR-1.2) — 로컬 서버(127.0.0.1:5321, vite 프록시 /api)의
 * 변환 엔드포인트(LibreDWG dwg2dxf 1순위 / ODA File Converter 폴백)를 소비한다.
 *
 * 순수 로직(응답 파싱·상태 분기)은 fetch와 분리해 단위 테스트한다 (convert-api.test.ts).
 * 주의: vite 프록시는 서버 미기동 시 fetch reject가 아니라 502/500 텍스트를 돌려주므로,
 * '네트워크 실패'와 'JSON 아님/비정상 응답'을 모두 서버 미기동으로 취급한다.
 */

/** 서버 미기동 안내 — 스펙 고정 문구 */
export const SERVER_DOWN_MESSAGE =
  '로컬 서버(pnpm dev)가 꺼져 있어 DWG 자동 변환 불가 — DXF로 저장 후 사용';

/** DWG 변환 백엔드 식별자 — 서버 status 응답의 backend 필드 (LibreDWG 1순위) */
export type ConvertBackendId = 'libredwg' | 'oda';

/** 백엔드 표시명 — 변환 진행 라벨 'DWG 변환 중 (LibreDWG)' 등에 사용 */
export function backendDisplayName(backend: ConvertBackendId): string {
  return backend === 'libredwg' ? 'LibreDWG' : 'ODA';
}

/** GET /api/convert/status 응답 계약 */
export interface ConvertStatus {
  installed: boolean;
  backend?: ConvertBackendId;
  path?: string;
  guide: string;
}

/** 상태 응답 파싱 — 계약과 다르면 null (프록시 오류 HTML 등) */
export function parseConvertStatus(value: unknown): ConvertStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.installed !== 'boolean' || typeof rec.guide !== 'string') return null;
  const status: ConvertStatus = { installed: rec.installed, guide: rec.guide };
  if (typeof rec.path === 'string') status.path = rec.path;
  // 알 수 없는 backend 값은 무시 — 구버전 서버·전방 호환
  if (rec.backend === 'libredwg' || rec.backend === 'oda') status.backend = rec.backend;
  return status;
}

/** .dwg 드롭 시 진행 경로 */
export type DwgRoute =
  | { kind: 'convert'; backend?: ConvertBackendId }
  | { kind: 'guide'; guide: string }
  | { kind: 'server-down'; message: string };

/** 상태 fetch 결과 — 'network-error'는 fetch 자체 실패 */
export type StatusFetchResult = { ok: boolean; body: unknown } | 'network-error';

/** 상태 응답 → 경로 분기 (순수) */
export function routeDwgByStatus(result: StatusFetchResult): DwgRoute {
  if (result === 'network-error') return { kind: 'server-down', message: SERVER_DOWN_MESSAGE };
  const status = result.ok ? parseConvertStatus(result.body) : null;
  // 프록시 502/500·비계약 응답 → 서버 미기동으로 간주
  if (status === null) return { kind: 'server-down', message: SERVER_DOWN_MESSAGE };
  if (!status.installed) return { kind: 'guide', guide: status.guide };
  return status.backend !== undefined
    ? { kind: 'convert', backend: status.backend }
    : { kind: 'convert' };
}

/** 'plan.dwg' → 'plan.dxf' (확장자 대소문자 무관, 확장자 없으면 .dxf 부여) */
export function dxfNameFromDwg(name: string): string {
  return /\.dwg$/i.test(name) ? `${name.slice(0, -4)}.dxf` : `${name}.dxf`;
}

/** 변환 실패 응답 → 한국어 메시지 (서버 메시지 우선, 없으면 상태코드별 기본값) */
export function convertErrorMessage(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  if (status === 413) return 'DWG 파일이 50MB 제한을 초과했습니다';
  if (status === 503) return 'DWG 변환 도구(LibreDWG 또는 ODA)가 설치되어 있지 않습니다';
  if (status === 504) return 'DWG 변환 시간 초과(60초) — DXF로 저장 후 사용하세요';
  return 'DWG 변환에 실패했습니다 — CAD에서 DXF(ASCII)로 저장 후 사용하세요';
}

/** GET /api/convert/status → 경로 분기. 예외를 던지지 않는다. */
export async function fetchDwgRoute(): Promise<DwgRoute> {
  let res: Response;
  try {
    res = await fetch('/api/convert/status');
  } catch {
    return routeDwgByStatus('network-error');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null; // JSON 아님(프록시 오류 텍스트) — server-down 분기로
  }
  return routeDwgByStatus({ ok: res.ok, body });
}

/** POST /api/convert — 성공 시 DXF 텍스트, 실패 시 한국어 메시지의 Error */
export async function convertDwgFile(file: File): Promise<string> {
  let res: Response;
  try {
    // 파일명은 참고용 — 서버는 업로드 바이트만 사용한다
    const form = new FormData();
    form.append('file', file, file.name);
    res = await fetch('/api/convert', { method: 'POST', body: form });
  } catch {
    throw new Error(SERVER_DOWN_MESSAGE);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new Error(convertErrorMessage(res.status, body));
  }
  return res.text();
}
