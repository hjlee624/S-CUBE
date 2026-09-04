/**
 * DWG 변환 백엔드 선택 (FR-1.2) — LibreDWG dwg2dxf 1순위, ODA File Converter 폴백.
 * 라우트(index.ts)는 이 모듈만 바라본다 — 개별 탐지 로직은 libredwg.ts / oda.ts.
 */
import { findLibredwgConverter, LIBREDWG_DOWNLOAD_URL } from './libredwg.ts';
import { findOdaConverter, ODA_DOWNLOAD_URL } from './oda.ts';

/** 변환 백엔드 식별자 — status 응답·변환 분기에 사용 */
export type ConvertBackend = 'libredwg' | 'oda';

/** 탐지된 변환기 — backend 종류 + 실행 파일 절대 경로 */
export interface ConverterInfo {
  backend: ConvertBackend;
  path: string;
}

/** 미설치 시 클라이언트에 전달하는 한국어 설치 안내 — LibreDWG 우선 */
export const DWG_GUIDE_MESSAGE =
  '무료 변환 도구를 설치하면 DWG를 자동으로 DXF로 변환합니다. ' +
  `권장 1안 LibreDWG(무료·등록 불필요): 1) ${LIBREDWG_DOWNLOAD_URL} 에서 win64 zip을 내려받아 ` +
  '2) 압축을 풀고 dwg2dxf.exe를 %USERPROFILE%/tools/libredwg/ 에 두거나 PATH에 등록한 뒤 ' +
  '3) 다시 시도하세요. 다른 위치는 환경변수 SCUBE_DWG2DXF_PATH로 지정할 수 있습니다. ' +
  `대안 2안 ODA File Converter(무료·이메일 등록 필요): ${ODA_DOWNLOAD_URL} 에서 내려받아 ` +
  '기본 경로(C:/Program Files/ODA)에 설치하면 자동 감지됩니다.';

/**
 * 탐지 — ODA 1순위, 없으면 LibreDWG 폴백. 둘 다 없으면 null.
 *
 * ODA 우선 이유(RW-27): 서버 변환은 이제 브라우저 WASM(libredwg)이 불완전할 때만(배치정보
 * 없는 블록 다수) 호출된다. 네이티브 LibreDWG dwg2dxf 는 WASM 과 같은 libredwg 라이브러리라
 * 같은 배치 누락 버그를 가진다 → 재시도해도 소용없다. ODA File Converter 는 다른(견고한)
 * 엔진이라 그 배치까지 읽어 완전한 DXF 를 만든다. 그래서 완전성이 필요한 이 경로에선 ODA 우선.
 */
export function findConverter(): ConverterInfo | null {
  const oda = findOdaConverter();
  if (oda !== null) return { backend: 'oda', path: oda };
  const libredwg = findLibredwgConverter();
  if (libredwg !== null) return { backend: 'libredwg', path: libredwg };
  return null;
}
