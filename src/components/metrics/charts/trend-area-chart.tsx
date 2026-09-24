'use client';

import {
  CHART_AXIS_PROPS,
  CHART_GRID_PROPS,
  CHART_TOOLTIP_CONTENT_STYLE,
} from '@tale/ui/chart-theme';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartRow, ChartSeries } from './types';

interface TrendAreaChartProps {
  data: ChartRow[];
  series: readonly ChartSeries[];
  xKey: string;
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  valueFormatter?: (value: number) => string;
  allowDecimals?: boolean;
}

/**
 * Generic stacked area trend (e.g. cumulative flow). Chart BODY only — wrap in
 * `<ChartCard>` for chrome. Series with the same `stackId` (default `'stack'`)
 * stack into bands. Fills its parent.
 */
export function TrendAreaChart({
  data,
  series,
  xKey,
  xTickFormatter,
  yTickFormatter,
  valueFormatter,
  allowDecimals = false,
}: TrendAreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={s.stackId ?? 'stack'}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.18}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
