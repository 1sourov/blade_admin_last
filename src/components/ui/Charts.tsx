import { useState } from 'react';
import { formatCompactNumber } from '../../lib/formatters';
import type { TimeSeriesPoint } from '../../types/blade';

interface ChartProps {
  title: string;
  subtitle: string;
  data: TimeSeriesPoint[];
  seriesKey: keyof Pick<
    TimeSeriesPoint,
    'users' | 'videos' | 'views' | 'engagement' | 'activeUsers'
  >;
  accent?: 'red' | 'black';
  type?: 'area' | 'bar';
  loading?: boolean;
}

export function MetricChartCard({
  title,
  subtitle,
  data,
  seriesKey,
  accent = 'black',
  type = 'area',
  loading = false,
}: ChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = data.map((d) => d[seriesKey]);
  const total = values.reduce((a, b) => a + b, 0);
  const maxVal = Math.max(...values, 0);
  const hasRealData = data.length > 0 && total > 0;

  const strokeColor = accent === 'red' ? '#dc2626' : '#09090b';
  const fillColor = accent === 'red' ? 'rgba(220, 38, 38, 0.12)' : 'rgba(9, 9, 11, 0.08)';

  const w = 520;
  const h = 170;
  const padX = 12;
  const padTop = 14;
  const padBottom = 10;
  const plotW = w - padX * 2;
  const plotH = h - padTop - padBottom;

  const points = data.map((d, idx) => {
    const x =
      data.length === 1 ? padX + plotW / 2 : padX + (idx / Math.max(1, data.length - 1)) * plotW;
    const yRatio = maxVal > 0 ? d[seriesKey] / maxVal : 0;
    const y = padTop + plotH - yRatio * plotH;
    return { x, y, point: d };
  });

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : '';

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-950">{title}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-zinc-950 tabular-nums">
            {loading ? '—' : hasRealData ? formatCompactNumber(total) : '0'}
          </div>
          <div className="text-[11px] text-zinc-500 tabular-nums">
            {hovered ? `${hovered.point.label}: ${formatCompactNumber(hovered.point[seriesKey])}` : 'Period total'}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-[170px] w-full bg-zinc-100 rounded animate-pulse" />
      ) : !hasRealData ? (
        <div className="h-[170px] w-full border border-dashed border-zinc-200 rounded flex items-center justify-center text-xs text-zinc-500">
          No data available
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full h-[170px] overflow-visible"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {[0.25, 0.5, 0.75, 1].map((frac) => {
              const gy = padTop + plotH * (1 - frac);
              return (
                <line
                  key={frac}
                  x1={padX}
                  x2={w - padX}
                  y1={gy}
                  y2={gy}
                  stroke="#f4f4f5"
                  strokeWidth="1"
                />
              );
            })}

            {type === 'area' ? (
              <>
                <path d={areaPath} fill={fillColor} />
                <path
                  d={linePath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            ) : (
              points.map((p, idx) => {
                const barW = Math.max(6, plotW / Math.max(1, data.length) - 6);
                const barH = Math.max(2, padTop + plotH - p.y);
                return (
                  <rect
                    key={p.point.date}
                    x={p.x - barW / 2}
                    y={p.y}
                    width={barW}
                    height={barH}
                    rx={2}
                    fill={hoverIdx === idx ? '#dc2626' : strokeColor}
                  />
                );
              })
            )}

            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  x2={hovered.x}
                  y1={padTop}
                  y2={padTop + plotH}
                  stroke="#d4d4d8"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={hovered.x}
                  cy={hovered.y}
                  r={4}
                  fill={strokeColor}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              </>
            )}

            {/* Invisible interactive hover columns */}
            {points.map((p, idx) => {
              const colW = plotW / Math.max(1, points.length);
              return (
                <rect
                  key={p.point.date}
                  x={p.x - colW / 2}
                  y={0}
                  width={colW}
                  height={h}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
              );
            })}
          </svg>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1 tabular-nums">
            <span>{data[0]?.label}</span>
            <span>{data[Math.floor(data.length / 2)]?.label}</span>
            <span>{data[data.length - 1]?.label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
