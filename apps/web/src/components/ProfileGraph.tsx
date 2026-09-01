/**
 * 종단 프로파일 미니 그래프 (P3-14) — x = chainage(m), y = 단면적(㎡).
 *
 * itemKey 별로 선을 그려 이상값을 시각적으로 검출한다(급변 지점이 꺾임으로 드러남).
 * SVG + 디자인 토큰(emerald 액센트·zinc 서페이스). 반올림은 축 라벨 표시에만.
 * 계산·정렬은 lib/station-derive.ts 순수 함수로만 한다.
 */
import type { StationSection } from '@s-cube/schema';
import { useMemo } from 'react';
import { formatArea, formatChainage } from '../lib/format.ts';
import { detectAnomalies, sortSections } from '../lib/station-derive.ts';
import { useAppStore } from '../store/index.ts';

/** itemKey 별 선 색 — emerald 계열 + 보조 톤 (디자인: emerald 단일 액센트 확장) */
const LINE_COLORS = ['#34d399', '#38bdf8', '#c084fc', '#fbbf24', '#f472b6', '#a3e635'] as const;

const W = 640;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

/** 데이터 공간 점 — 화면 좌표(x,y) 는 렌더 시점에 toX/toY 로 변환한다 */
interface DataPoint {
  chainage_m: number;
  area_m2: number;
  sectionId: string;
}

interface Series {
  itemKey: string;
  color: string;
  points: DataPoint[];
}

export function ProfileGraph() {
  const sections = useAppStore((s) => s.sections);
  const itemKeys = useAppStore((s) => s.itemKeys);
  const stationInterval_m = useAppStore((s) => s.stationInterval_m);

  // 데이터가 있는 항목만.
  const activeKeys = useMemo(
    () => itemKeys.filter((k) => sections.some((s) => s.itemKey === k)),
    [itemKeys, sections],
  );

  // x·y 도메인 (전 항목 통합).
  const domain = useMemo(() => {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = 0;
    for (const s of sections) {
      minX = Math.min(minX, s.station.chainage_m);
      maxX = Math.max(maxX, s.station.chainage_m);
      maxY = Math.max(maxY, s.area_m2);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 1;
    }
    if (maxX === minX) maxX = minX + 1;
    if (maxY <= 0) maxY = 1;
    return { minX, maxX, maxY };
  }, [sections]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const toX = (chainage_m: number) =>
    PAD.left + ((chainage_m - domain.minX) / (domain.maxX - domain.minX)) * plotW;
  const toY = (area_m2: number) => PAD.top + plotH - (area_m2 / domain.maxY) * plotH;

  // 데이터 공간 시리즈 — 화면 변환(toX/toY)과 분리해 domain 변화에 독립. 렌더에서 변환.
  const series = useMemo<Series[]>(() => {
    return activeKeys.map((key, i) => {
      const rows: StationSection[] = sortSections(sections.filter((s) => s.itemKey === key));
      const color = LINE_COLORS[i % LINE_COLORS.length] ?? '#34d399';
      const points: DataPoint[] = rows.map((r) => ({
        chainage_m: r.station.chainage_m,
        area_m2: r.area_m2,
        sectionId: r.id,
      }));
      return { itemKey: key, color, points };
    });
  }, [activeKeys, sections]);

  // 이상 단면 id 집합 — 그래프에 amber 링으로 표시.
  const anomalyIds = useMemo(() => {
    const set = new Set<string>();
    for (const key of activeKeys) {
      for (const an of detectAnomalies(sections, key, stationInterval_m)) {
        if (an.sectionId !== undefined) set.add(an.sectionId);
      }
    }
    return set;
  }, [sections, activeKeys, stationInterval_m]);

  const hasData = series.some((s) => s.points.length > 0);

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      {!hasData ? (
        <p className="p-6 text-center text-xs text-zinc-500">
          단면적을 입력하면 종단 프로파일이 그려집니다. 급변 지점이 꺾임으로 드러나 이상값을 눈으로
          찾을 수 있습니다.
        </p>
      ) : (
        <>
          {/* 범례 */}
          <div className="flex flex-wrap gap-3 text-[11px]">
            {series.map((s) => (
              <span key={s.itemKey} className="flex items-center gap-1.5 text-zinc-400">
                <span
                  className="inline-block h-2 w-3 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.itemKey}
              </span>
            ))}
            {anomalyIds.size > 0 && (
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-400" />
                이상값
              </span>
            )}
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950"
            role="img"
            aria-label="종단 프로파일 그래프 (측점별 단면적)"
          >
            {/* y 격자·라벨 (0·중간·최대) */}
            {[0, 0.5, 1].map((f) => {
              const area = domain.maxY * f;
              const y = toY(area);
              return (
                <g key={f}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={W - PAD.right}
                    y2={y}
                    stroke="#27272a"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-zinc-600 text-[9px]"
                  >
                    {formatArea(area, 1)}
                  </text>
                </g>
              );
            })}

            {/* x 축 라벨 (양 끝) */}
            <text x={PAD.left} y={H - 8} textAnchor="start" className="fill-zinc-600 text-[9px]">
              {formatChainage(domain.minX)}
            </text>
            <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-zinc-600 text-[9px]">
              {formatChainage(domain.maxX)}
            </text>

            {/* itemKey 별 선 + 점 — 데이터 공간 점을 화면 좌표로 변환해 그린다 */}
            {series.map((s) => (
              <g key={s.itemKey}>
                {s.points.length >= 2 && (
                  <polyline
                    points={s.points.map((p) => `${toX(p.chainage_m)},${toY(p.area_m2)}`).join(' ')}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                )}
                {s.points.map((p) => {
                  const cx = toX(p.chainage_m);
                  const cy = toY(p.area_m2);
                  const isAnomaly = anomalyIds.has(p.sectionId);
                  return (
                    <g key={p.sectionId}>
                      <circle cx={cx} cy={cy} r={2.6} fill={s.color}>
                        <title>{`${s.itemKey} · chainage ${formatChainage(p.chainage_m)} · ${formatArea(p.area_m2)}`}</title>
                      </circle>
                      {isAnomaly && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={5.5}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth={1.5}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>

          <p className="text-[10px] leading-relaxed text-zinc-600">
            x = 측점 chainage(m), y = 단면적(㎡). 인접 단면적이 급변하거나 0·음수인 지점은 amber
            링으로 표시됩니다.
          </p>
        </>
      )}
    </div>
  );
}
