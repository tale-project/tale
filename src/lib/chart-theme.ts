import type { CSSProperties } from 'react';

/**
 * The single source of truth for chart styling across the platform.
 *
 * Every color is a `var(--color-chart-*)` reference (defined in
 * `packages/ui/src/globals.css` for both `:root` and `.dark`) — never a
 * hardcoded hex. This is what makes charts theme-aware: the same token resolves
 * to a light- or dark-tuned value depending on the surrounding `.dark` scope.
 * Consumers (recharts wrappers, the SVG Sparkline, legend swatches) pull from
 * here so all charts share one palette.
 */

/** Semantic chart fills — outcome-coded (success/failure) + supporting hues. */
export const CHART_COLORS = {
  success: 'var(--color-chart-success)',
  failure: 'var(--color-chart-failure)',
  warning: 'var(--color-chart-warning)',
  neutral: 'var(--color-chart-neutral)',
  primary: 'var(--color-chart-primary)',
} as const;

export type ChartColorName = keyof typeof CHART_COLORS;

/** Categorical palette for multi-series charts without an inherent meaning. */
export const CHART_SERIES = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
] as const;

/** Pick a categorical series color by index, wrapping around the palette. */
export function getChartSeriesColor(index: number): string {
  return CHART_SERIES[
    ((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length
  ];
}

/**
 * Shared recharts `<Tooltip contentStyle>` so every chart tooltip looks the
 * same. Uses the hsl-wrapped `--color-*` tokens (NOT the raw `--popover` HSL
 * triple, which is not a valid standalone color value).
 */
export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-popover)',
  color: 'var(--color-popover-foreground)',
};

/** Shared `<CartesianGrid>` props — dashed horizontal lines only. */
export const CHART_GRID_PROPS = {
  strokeDasharray: '3 3',
  vertical: false,
  className: 'stroke-border',
} as const;

/** Shared `<XAxis>` / `<YAxis>` props — small muted ticks, no axis/tick lines. */
export const CHART_AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11 },
  className: 'text-muted-foreground',
} as const;
