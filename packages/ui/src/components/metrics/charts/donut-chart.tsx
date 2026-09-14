'use client';

import { CHART_TOOLTIP_CONTENT_STYLE } from '@tale/ui/chart-theme';
import { type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { DonutSegment } from './types';

interface DonutChartProps {
  segments: readonly DonutSegment[];
  /** Big number shown in the ring center (e.g. the total). */
  centerValue?: ReactNode;
  /** Caption under the center value. */
  centerLabel?: string;
  /** Format segment values in the tooltip. */
  valueFormatter?: (value: number) => string;
}

/**
 * Generic donut/ring chart with an optional center total. Chart BODY only —
 * wrap in `<ChartCard>` for the title/legend chrome (build the legend from the
 * same segments via `segmentsToLegend`). Zero-value segments are dropped from
 * the ring. Fills its parent.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  valueFormatter,
}: DonutChartProps) {
  const slices = segments.filter((s) => s.value > 0);

  return (
    <div className="relative flex size-full items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
            formatter={(value) =>
              typeof value === 'number' && valueFormatter
                ? valueFormatter(value)
                : String(value)
            }
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined || centerLabel ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue !== undefined ? (
            <span className="text-2xl font-semibold tabular-nums">
              {centerValue}
            </span>
          ) : null}
          {centerLabel ? (
            <span className="text-muted-foreground text-xs">{centerLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
