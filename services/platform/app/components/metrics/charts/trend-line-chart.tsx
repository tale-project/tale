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

interface TrendLineChartProps {
  data: ChartRow[];
  series: readonly ChartSeries[];
  xKey: string;
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  valueFormatter?: (value: number) => string;
  allowDecimals?: boolean;
}

/**
 * Generic multi-series line trend (e.g. cycle time). Chart BODY only — wrap in
 * `<ChartCard>` for chrome. Fills its parent.
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
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
