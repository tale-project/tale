'use client';

import {
  CHART_AXIS_PROPS,
  CHART_GRID_PROPS,
  CHART_TOOLTIP_CONTENT_STYLE,
} from '@tale/ui/chart-theme';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartRow, ChartSeries } from './types';

interface TrendBarChartProps {
  data: ChartRow[];
  series: readonly ChartSeries[];
  /** Data key for the X axis (e.g. a full date key). */
  xKey: string;
  /** Shorten the X tick label (the tooltip still shows the raw `xKey` value). */
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  /** Format series values in the tooltip. */
  valueFormatter?: (value: number) => string;
  allowDecimals?: boolean;
}

/**
 * Generic single/stacked bar trend. The chart BODY only — wrap it in a
 * `<ChartCard>` for the title/legend/loading/empty chrome. Series sharing a
 * `stackId` stack together; the topmost stacked segment gets rounded corners.
 * Fills its parent, so set the height on the `ChartCard` body.
 */
export function TrendBarChart({
  data,
  series,
  xKey,
  xTickFormatter,
  yTickFormatter,
  valueFormatter,
  allowDecimals = false,
}: TrendBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
        {series.map((s, i) => {
          const isLast = i === series.length - 1;
          const rounded = s.stackId ? isLast : true;
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={s.stackId}
              radius={rounded ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
