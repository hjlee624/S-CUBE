/**
 * 레이어 패널 (P1-8) — 색상 스와치·엔티티 수·표시 토글 + 미지원 엔티티 집계 (P1-2 연동).
 */
import type { CSSProperties } from 'react';
import {
  aciToRgb,
  orphanedBlockCount,
  paperSpaceExcludedCount,
  sanitizedCount,
} from '../lib/core-api.ts';
import { formatCount } from '../lib/format.ts';
import { useAppStore } from '../store/index.ts';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M6.3 3.9A6.6 6.6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2.1 2.6M4 5.2A11.6 11.6 0 0 0 1.5 8S4 12.5 8 12.5c.9 0 1.7-.2 2.4-.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LayerPanel() {
  const model = useAppStore((s) => s.model);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const setAllLayersVisible = useAppStore((s) => s.setAllLayersVisible);

  const unsupported = model !== null ? Object.entries(model.unsupportedCounts) : [];
  // 손상 좌표(비유한·초대형)로 폐기·정제된 엔티티 수 — core 진단 필드 (>0일 때만 안내)
  const sanitized = model !== null ? sanitizedCount(model) : 0;
  const paperExcluded = model !== null ? paperSpaceExcludedCount(model) : 0;
  // DWG 변환이 배치 INSERT를 잃어 렌더 못 하는 설계 객체 — 사용자 조치 필요 (>0일 때만 경고)
  const orphaned = model !== null ? orphanedBlockCount(model) : 0;

  return (
    <aside className="flex w-60 shrink-0 animate-panel-left flex-col border-r border-zinc-800 bg-zinc-950 [animation-delay:80ms]">
      <div className="flex items-center justify-between border-b border-zinc-800/70 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">레이어</p>
        {model !== null && model.layers.length > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setAllLayersVisible(true)}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300"
            >
              전체 켬
            </button>
            <button
              type="button"
              onClick={() => setAllLayersVisible(false)}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-zinc-300"
            >
              전체 끔
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {model === null ? (
          <p className="px-2 py-3 text-xs text-zinc-600">도면을 열면 레이어가 표시됩니다</p>
        ) : (
          <ul className="space-y-px">
            {model.layers.map((layer, i) => {
              const visible = layerVisibility[layer.name] ?? true;
              const color = aciToRgb(layer.colorIndex);
              return (
                <li
                  key={layer.name}
                  className="animate-row-in"
                  style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => toggleLayer(layer.name)}
                    title={`${layer.name} — ${formatCount(layer.entityCount)}개`}
                    className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all duration-150 ease-out hover:translate-x-0.5 hover:bg-zinc-900 active:scale-[0.985] ${
                      visible ? '' : 'opacity-45'
                    }`}
                    style={{ '--swatch-color': color } as CSSProperties}
                  >
                    <span
                      className="layer-swatch h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-white/10"
                      style={{ backgroundColor: color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                      {layer.name}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-600 tabular-nums">
                      {formatCount(layer.entityCount)}
                    </span>
                    <span
                      key={String(visible)}
                      className={`animate-eye-pop transition-colors duration-150 ${
                        visible ? 'text-emerald-400' : 'text-zinc-600 group-hover:text-zinc-400'
                      }`}
                    >
                      <EyeIcon open={visible} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 고아 블록 경고 — DWG 변환이 배치 INSERT를 잃어 설계 객체를 렌더 못 함 (P1-2).
          단순 집계가 아니라 사용자 조치가 필요하므로 테두리·아이콘으로 강조한다. */}
      {orphaned > 0 && (
        <div className="border-t border-zinc-800/70 px-3 py-2.5">
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2">
            <svg
              viewBox="0 0 16 16"
              className="mt-px h-3.5 w-3.5 shrink-0 text-red-400"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 1.5 15 14H1L8 1.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="11.6" r="0.75" fill="currentColor" />
            </svg>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-red-300">
                설계 객체 약 {formatCount(orphaned)}개가 DWG 변환 중 누락됨
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-red-400/80">
                CAD에서 DXF로 직접 저장하거나 ODA File Converter 사용을 권장합니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 손상 좌표 자동 정리 안내 — core가 비유한·초대형 좌표를 폐기·정제한 경우 (경고 톤) */}
      {sanitized > 0 && (
        <div className="border-t border-zinc-800/70 px-3 py-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-400"
            title="비유한·초대형 좌표를 가진 엔티티를 자동으로 정리해 화면 표시를 정상화했습니다"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
            </span>
            좌표 이상 {formatCount(sanitized)}건 자동 정리됨
          </span>
        </div>
      )}

      {/* 레이아웃(페이퍼 스페이스) 제외 안내 — 도곽·표제부는 모델 뷰에서 걷어낸다 */}
      {paperExcluded > 0 && (
        <div className="border-t border-zinc-800/70 px-3 py-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold text-sky-400"
            title="레이아웃(페이퍼 스페이스)의 도곽·표제부를 제외하고 모델 공간 객체만 표시합니다"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            레이아웃 {formatCount(paperExcluded)}건 제외 (모델만 표시)
          </span>
        </div>
      )}

      {/* 미지원 엔티티 — 조용히 버리지 않는다 (P1-2) */}
      {unsupported.length > 0 && (
        <div className="border-t border-zinc-800/70 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500/80">
            미지원 엔티티
          </p>
          <ul className="mt-1 space-y-0.5">
            {unsupported.map(([type, count]) => (
              <li key={type} className="flex justify-between font-mono text-[10px] text-zinc-500">
                <span>{type}</span>
                <span>{formatCount(count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
