/**
 * 앱 셸 — 3분할 레이아웃 (P0-5)
 * 좌: 도구 패널 / 중앙: 도면 캔버스 / 우: 속성 패널
 * Phase 1에서 캔버스 렌더러가 중앙 영역에 얹힌다.
 */
export function App() {
  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <h1 className="font-mono text-sm font-bold tracking-widest text-emerald-400">S-CUBE</h1>
        <span className="text-xs text-zinc-500">단면(㎡) × 연장(m) = 체적(㎥)</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-zinc-800 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">도구</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-400">
            <li>도면</li>
            <li>캘리브레이션</li>
            <li>측정</li>
            <li>측점</li>
            <li>규격</li>
          </ul>
        </aside>

        <main className="flex min-w-0 flex-1 items-center justify-center bg-zinc-900">
          <p className="text-sm text-zinc-600">DXF 도면을 열어주세요 (Phase 1에서 구현)</p>
        </main>

        <aside className="w-72 shrink-0 border-l border-zinc-800 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">속성</p>
        </aside>
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 px-4 font-mono text-xs text-zinc-500">
        <span>축척 미설정</span>
        <span>—</span>
      </footer>
    </div>
  );
}
