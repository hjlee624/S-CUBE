/**
 * 엔트리 히어로 — 도면 열기 전 빈 캔버스 화면.
 * 브랜드 타이틀 문자 스태거 리빌 + 도트 그리드·저속 emerald 그라디언트 배경 +
 * 드래그앤드롭 유도 CTA + 최근 파일 카드. 도면 로드 시 hero-exit로 우아하게 퇴장.
 */
import { useEffect, useState } from 'react';
import { pickDxfFile } from '../lib/open-file.ts';
import { loadRecentFiles } from '../lib/recent-files.ts';
import { useAppStore } from '../store/index.ts';

const BRAND = ['S', '-', 'C', 'U', 'B', 'E'] as const;

export function EmptyHero() {
  const model = useAppStore((s) => s.model);
  const loading = useAppStore((s) => s.loading);
  const loadError = useAppStore((s) => s.loadError);

  const visible = model === null && !loading.active;
  const [mounted, setMounted] = useState(visible);
  const [recent] = useState(loadRecentFiles);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      className={`absolute inset-0 z-10 flex items-center justify-center ${
        visible ? 'pointer-events-auto' : 'pointer-events-none animate-hero-exit'
      }`}
      onAnimationEnd={(e) => {
        if (!visible && e.target === e.currentTarget) setMounted(false);
      }}
    >
      {/* 배경 — 도트 그리드 + 초저속 emerald 그라디언트 드리프트 (가장자리 전용, Daylight 규칙) */}
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 animate-grad-drift opacity-[0.07]"
          style={{
            backgroundImage:
              'conic-gradient(from 0deg, transparent 0%, #10b981 12%, transparent 30%, transparent 55%, #2dd4bf 68%, transparent 85%)',
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,transparent_30%,#09090b_100%)]" />
      </div>

      <div className="relative flex flex-col items-center">
        {/* 브랜드 타이틀 — 문자 스태거 리빌 */}
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-500/90">
          Quantity Takeoff CAD
        </p>
        <h2
          aria-label="S-CUBE"
          className="mt-2 flex overflow-hidden font-mono text-6xl font-bold tracking-[0.08em] text-zinc-100"
        >
          {BRAND.map((ch, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 정적 문자 배열 — 순서 불변
              key={i}
              className={`animate-char-rise inline-block ${ch === '-' ? 'text-emerald-400' : ''}`}
              style={{ animationDelay: `${90 + i * 55}ms` }}
            >
              {ch}
            </span>
          ))}
        </h2>
        <p
          className="mt-3 animate-fade-in-up text-sm text-zinc-500"
          style={{ animationDelay: '420ms' }}
        >
          단면(㎡) × 연장(m) = 체적(㎥) — 도면에서 수량까지
        </p>

        {/* 드롭 유도 CTA 카드 */}
        <div
          className="glow-card mt-8 animate-fade-in-up rounded-2xl bg-zinc-900/70 px-10 py-7 text-center backdrop-blur-sm"
          style={{ animationDelay: '520ms' }}
        >
          <p className="text-sm text-zinc-400">DXF·DWG 파일을 이곳에 끌어다 놓거나</p>
          <button
            type="button"
            onClick={pickDxfFile}
            className="group relative mt-4 overflow-hidden rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all duration-200 ease-out hover:bg-emerald-400 hover:shadow-[0_0_0_4px_rgba(52,211,153,0.22),0_8px_28px_rgba(16,185,129,0.35)] active:scale-[0.97]"
          >
            <span className="relative z-10">도면 열기</span>
            {/* shine 스윕 — 시선 유도 1회성 루프 */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </button>
          <p className="mt-3 text-[11px] text-zinc-600">
            DWG는 로컬 서버가 자동 변환합니다 (ODA File Converter)
          </p>
          {loadError !== null && (
            <p className="mt-4 max-w-xs animate-fade-in-up rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-400">
              파싱 실패: {loadError}
            </p>
          )}
        </div>

        {/* 최근 파일 — 이름 기록 카드 (클릭 시 파일 선택 다이얼로그) */}
        {recent.length > 0 && (
          <div
            className="mt-5 flex animate-fade-in-up flex-col items-center gap-1.5"
            style={{ animationDelay: '640ms' }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
              최근 도면
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {recent.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={pickDxfFile}
                  title={`${f.name} — 다시 선택하려면 클릭 (${new Date(f.openedAt).toLocaleDateString('ko-KR')})`}
                  className="rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 font-mono text-[11px] text-zinc-400 transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border-emerald-700/50 hover:text-emerald-300 active:scale-[0.97]"
                >
                  {f.name}
                  <span className="ml-1.5 text-zinc-600">
                    {f.entityCount.toLocaleString('ko-KR')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
