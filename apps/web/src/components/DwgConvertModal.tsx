/**
 * DWG 변환 안내 모달 (FR-1.2) — 변환 백엔드 미설치 시 설치 가이드.
 * 권장 1안: LibreDWG dwg2dxf (무료·가입/등록 불필요) — 다운로드 링크 + 설치 3단계.
 * 대안 2안: ODA File Converter (무료·이메일 등록 필요).
 * 다운로드 링크 + '설치 후 재시도'로 동일 DWG 파일 변환을 즉시 재시작한다.
 * 디자인 언어: glow-card + animate-modal-in (캘리브레이션 모달과 동일 계열).
 */
import { useEffect } from 'react';
import { openDrawingFile } from '../lib/open-file.ts';
import { useAppStore } from '../store/index.ts';

const LIBREDWG_DOWNLOAD_URL = 'https://github.com/LibreDWG/libredwg/releases';
const ODA_DOWNLOAD_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

const LIBREDWG_STEPS = [
  '아래 링크에서 win64 zip을 내려받습니다 — 가입·등록이 필요 없습니다.',
  '압축을 풀고 dwg2dxf.exe를 %USERPROFILE%/tools/libredwg/ 에 두거나 PATH에 등록합니다.',
  '아래 [설치 후 재시도]를 누르면 같은 DWG를 바로 변환합니다.',
] as const;

export function DwgConvertModal() {
  const dwgGuide = useAppStore((s) => s.dwgGuide);
  const dismissDwgGuide = useAppStore((s) => s.dismissDwgGuide);

  useEffect(() => {
    if (dwgGuide === null) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissDwgGuide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dwgGuide, dismissDwgGuide]);

  if (dwgGuide === null) return null;

  const retry = () => {
    const file = dwgGuide.file;
    dismissDwgGuide();
    openDrawingFile(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="DWG 자동 변환 도구 설치 안내"
    >
      <div className="glow-card w-[28rem] animate-modal-in rounded-xl bg-zinc-900 p-5">
        <p className="text-sm font-semibold text-zinc-100">DWG 자동 변환 도구가 필요합니다</p>
        <p className="mt-1 text-xs text-zinc-500">
          <span className="font-mono text-zinc-300">{dwgGuide.file.name}</span> 을(를) 열려면 무료
          변환 도구가 필요합니다. 설치는 1분이면 끝납니다.
        </p>

        {/* 권장 1안 — LibreDWG (등록 불필요) */}
        <div className="mt-4 rounded-lg border border-emerald-800/40 bg-zinc-950/70 p-3">
          <p className="text-xs font-semibold text-emerald-300">
            권장 1안 — LibreDWG{' '}
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px]">
              무료 · 등록 불필요
            </span>
          </p>
          <ol className="mt-2 space-y-2 text-xs text-zinc-400">
            {LIBREDWG_STEPS.map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-[10px] text-emerald-300">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <a
            href={LIBREDWG_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block truncate rounded-lg border border-emerald-800/50 bg-emerald-500/5 px-3 py-2 text-center font-mono text-[11px] text-emerald-300 transition-all duration-150 hover:border-emerald-600/60 hover:bg-emerald-500/10 active:scale-[0.98]"
          >
            {LIBREDWG_DOWNLOAD_URL} ↗
          </a>
        </div>

        {/* 대안 2안 — ODA File Converter (등록 필요) */}
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="text-xs font-semibold text-zinc-400">
            대안 2안 — ODA File Converter{' '}
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              무료 · 이메일 등록 필요
            </span>
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            기본 경로(C:/Program Files/ODA)에 설치하면 자동으로 감지됩니다.
          </p>
          <a
            href={ODA_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate rounded-lg border border-zinc-800 px-3 py-1.5 text-center font-mono text-[11px] text-zinc-400 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-800/50 active:scale-[0.98]"
          >
            {ODA_DOWNLOAD_URL} ↗
          </a>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">{dwgGuide.guide}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismissDwgGuide}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 transition-all duration-150 hover:bg-zinc-800 hover:text-zinc-200 active:scale-[0.97]"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={retry}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.97]"
          >
            설치 후 재시도
          </button>
        </div>
      </div>
    </div>
  );
}
