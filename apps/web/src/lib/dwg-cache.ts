/**
 * RW-27: DWG→DXF 변환 결과 캐시 (IndexedDB).
 *
 * DWG 를 열 때마다 9.5MB WASM 로드 + 변환을 반복하지 않도록, 변환 산출물(DXF 텍스트 +
 * 통계)을 DWG 바이트 내용 해시로 키잉해 캐시한다. 같은 DWG 재열기 시 변환을 건너뛰고
 * 캐시된 DXF 를 바로 파싱한다(수 초 → 수십 ms).
 *
 * 워커·메인 스레드 양쪽에서 쓸 수 있게 IndexedDB 를 쓴다(localStorage 는 대형 DXF 부적합).
 */

const DB_NAME = 's-cube-dwg-cache';
const STORE = 'conv';
const DB_VERSION = 1;

/** 캐시 값 — 변환 산출물 */
export interface CachedConversion {
  dxf: string;
  skipped: Record<string, number>;
  unplaced: { count: number; names: string[] };
  /** 캐시 스키마/변환기 버전 — 변환 로직이 바뀌면 무효화하려고 키에 섞는다 */
  v: number;
}

/** 변환기 로직 버전 — dwgDatabaseToDxf 개선 시 올리면 기존 캐시 자동 무효화 */
export const CONVERTER_VERSION = 3;

/** DWG 바이트 내용 해시 (FNV-1a 32bit + 길이) — 순수, 빠름(수 MB ~ 수 ms) */
export function hashDwgBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return `dwg:v${CONVERTER_VERSION}:${(h >>> 0).toString(16)}:${b.length}`;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** 캐시 조회 — 없거나 오류면 null (조용히 미스 처리) */
export async function getCachedConversion(key: string): Promise<CachedConversion | null> {
  const db = await openDb();
  if (db === null) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const val = req.result as CachedConversion | undefined;
        resolve(val !== undefined && val.v === CONVERTER_VERSION ? val : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      db.close();
    }
  });
}

/** 캐시 저장 — 실패는 조용히 무시(캐시는 최적화일 뿐) */
export async function setCachedConversion(key: string, value: CachedConversion): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    } finally {
      db.close();
    }
  });
}
