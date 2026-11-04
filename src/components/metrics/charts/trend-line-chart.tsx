'use client';

import {
  CHART_AXIS_PROPS,
  CHART_GRID_PROPS,
  CHART_TOOLTIP_CONTENT_STYLE,
} from '@tale/ui/chart-theme';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartRow, ChartSeries } from './types';
import { useChartAnimation } from './use-chart-animation';

interface TrendLineChartProps {
  data: ChartRow[];
  series: readonly ChartSeries[];
  xKey: string;
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  valueFormatter?: (value: number) => string;
  allowDecimals?: boolean;
}

/** How many rows carry a number for the series — gaps (`null`) don't. */
function plottedPoints(data: ChartRow[], key: string): number {
  let count = 0;
  for (const row of data) {
    if (typeof row[key] === 'number') count += 1;
  }
  return count;
}

/**
 * Generic multi-series line trend (e.g. cycle time). Chart BODY only — wrap in
 * `<ChartCard>` for chrome. Fills its parent. A series with a single plotted
 * point shows it as a dot, since a line alone would paint nothing.
 */
export function TrendLineChart({
  data,
  series,
  xKey,
  xTickFormatter,
  yTickFormatter,
  valueFormatter,
  allowDecimals = true,
}: TrendLineChartProps) {
  const animate = useChartAnimation();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...CHART_GRID_PROPS} />
        <XAxis
          dataKey={xKey}
          tickMargin={8}
          tickFormatter={xTickFormatter}
          {...CHART_AXIS_PROPS}
        />
        <YAxis
          width={36}
          allowDecimals={allowDecimals}
          tickFormatter={yTickFormatter}
          {...CHART_AXIS_PROPS}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
          formatter={(value) =>
            typeof value === 'number' && valueFormatter
              ? valueFormatter(value)
              : String(value)
          }
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            // A line needs two points; a series with one plotted value would
            // otherwise paint nothing while its KPI card shows the figure.
            dot={plottedPoints(data, s.key) <= 1 ? { r: 3 } : false}
            activeDot={{ r: 3 }}
            connectNulls
            isAnimationActive={animate}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
