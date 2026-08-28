/**
 * 최근 열람 도면 이름 기록 (localStorage) — 엔트리 화면 빠른 안내 카드용.
 * 브라우저 보안상 파일 핸들 없이 재열기는 불가 — 이름만 노출하고
 * 클릭 시 파일 선택 다이얼로그를 다시 연다.
 */

const KEY = 's-cube:recent:v1';
const MAX = 4;

export interface RecentFile {
  name: string;
  openedAt: number;
  entityCount: number;
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is RecentFile =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as RecentFile).name === 'string' &&
        typeof (v as RecentFile).openedAt === 'number' &&
        typeof (v as RecentFile).entityCount === 'number',
    );
  } catch {
    return [];
  }
}

export function pushRecentFile(name: string, entityCount: number): void {
  try {
    const rest = loadRecentFiles().filter((f) => f.name !== name);
    const next: RecentFile[] = [{ name, openedAt: Date.now(), entityCount }, ...rest].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 실패는 무시 — 부가 기능
  }
}
