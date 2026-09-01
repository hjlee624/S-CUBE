/**
 * 구간 체적 테이블 (P3-13) — itemKey 별 buildSegments 결과.
 *
 * 열: 시점~종점, 연장, 평균단면적, 체적(㎥, 표시 반올림·내부 full).
 * 전/후 불연속(연장 0)·결측 에러를 명확히 표시(에러면 빨강 + 사유 + 산출 차단 안내).
 * itemKey 별 합계 체적. 계산은 lib/station-derive.ts 순수 함수로만 한다.
 */
import { useMemo } from 'react';
import { formatArea, formatChainage, formatVolume } from '../lib/format.ts';
import {
  type BuildSegmentsResult,
  buildSegments,
  type SegmentError,
  totalVolume,
} from '../lib/station-derive.ts';
import { useAppStore } from '../store/index.ts';

/** 한 itemKey 블록 — 구간·에러·합계 */
function ItemBlock({ itemKey }: { itemKey: string }) {
  const sections = useAppStore((s) => s.sections);

  const result: BuildSegmentsResult = useMemo(
    () => buildSegments(sections, itemKey),
    [sections, itemKey],
  );
  const { segments, errors, blocked } = result;
  // 합계는 계산 계층(totalVolume)이 blocked 면 null 을 준다 — UI 가 부분합을 임의로
  // 만들지 않는다. null 이면 '산출 차단' 으로 표시한다(곡성류 부분합 누출 방지).
  const total = useMemo(() => totalVolume(result), [result]);

  const hasRows = segments.length > 0 || errors.length > 0;

  return (
    <section className="animate-fade-in-up rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-emerald-300">{itemKey}</span>
          {errors.length > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
              에러 {errors.length}
            </span>
          )}
        </div>
        <div className="text-[11px] text-zinc-400">
          합계{' '}
          <span className="font-mono tabular-nums text-emerald-300">
            {total === null ? '산출 차단' : formatVolume(total)}
          </span>
        </div>
      </header>

      {!hasRows ? (
        <p className="px-3 py-3 text-[11px] text-zinc-500">
          단면이 2개 이상이면 구간이 생성됩니다.
        </p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-1.5 font-semibold">시점 → 종점</th>
              <th className="px-3 py-1.5 text-right font-semibold">연장</th>
              <th className="px-3 py-1.5 text-right font-semibold">A1 / A2</th>
              <th className="px-3 py-1.5 text-right font-semibold">평균단면적</th>
              <th className="px-3 py-1.5 text-right font-semibold">체적</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => {
              const isDiscontinuity =
                seg.length_m === 0 &&
                seg.from.discontinuity === 'pre' &&
                seg.to.discontinuity === 'post';
              const avg = (seg.a1 + seg.a2) / 2;
              return (
                <tr
                  key={`${seg.from.raw}__${seg.to.raw}`}
                  className={`animate-row-in border-t border-zinc-900 ${
                    isDiscontinuity ? 'bg-violet-950/15' : 'hover:bg-zinc-900/30'
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-300">
                    {seg.from.raw} → {seg.to.raw}
                    {isDiscontinuity && (
                      <span
                        className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-semibold text-violet-300"
                        title="전/후 불연속 경계 — 연장 0, 체적 발생 안 함 (중복 계상 방지)"
                      >
                        전/후 불연속
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                    {formatChainage(seg.length_m)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-500">
                    {seg.a1.toFixed(4)} / {seg.a2.toFixed(4)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                    {formatArea(avg)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-mono text-[11px] tabular-nums ${
                      isDiscontinuity ? 'text-violet-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatVolume(seg.volume_m3)}
                  </td>
                </tr>
              );
            })}

            {/* 결측·전후불연속 결측 에러 행 — 빨강 + 사유 + 산출 차단 안내 */}
            {errors.map((err: SegmentError) => (
              <tr
                key={`err__${err.chainage_m}__${err.kind}`}
                className="animate-row-in border-t border-red-900/40 bg-red-950/15"
              >
                <td colSpan={5} className="px-3 py-1.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-px rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-semibold text-red-300">
                      {err.kind === 'pre-missing' ? '(전) 단면 결측' : '단면적 결측'}
                    </span>
                    <p className="text-[10px] leading-relaxed text-red-300">
                      chainage {formatChainage(err.chainage_m)} — {err.reason}
                    </p>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {blocked && (
        <p className="border-t border-red-900/30 bg-red-950/10 px-3 py-1.5 text-[10px] leading-relaxed text-red-300/90">
          결측 단면이 있어 이 항목의 총 체적 산출을 차단합니다. 조용히 0 으로 처리하지 않습니다 —
          누락 단면을 채운 뒤 다시 확인하세요 (곡성 (전) 단면 누락 재발 방지).
        </p>
      )}
    </section>
  );
}

export function SegmentTable() {
  const itemKeys = useAppStore((s) => s.itemKeys);
  const sections = useAppStore((s) => s.sections);

  // 실제 단면이 있는 항목만 표시(빈 항목 노이즈 억제). 항상 하나는 보이게 fallback.
  const activeKeys = useMemo(() => {
    const withData = itemKeys.filter((k) => sections.some((s) => s.itemKey === k));
    return withData.length > 0 ? withData : itemKeys.slice(0, 1);
  }, [itemKeys, sections]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      {activeKeys.map((key) => (
        <ItemBlock key={key} itemKey={key} />
      ))}
    </div>
  );
}
