import type { ChartLegendItem } from '@tale/ui/chart-legend';

/**
 * One plotted series in a trend chart. `color` should be a chart-theme token
 * (`var(--color-chart-*)` from `@tale/ui/chart-theme`) so the series matches
 * its legend swatch and resolves correctly in dark mode. `stackId` groups
 * series into a stack (bars/areas); omit it for grouped/overlaid series.
 */
export interface ChartSeries {
  /** Key into each data row. */
  key: string;
  /** Already-translated display name (legend + tooltip). */
  label: string;
  /** Fill/stroke color — a chart-theme token. */
  color: string;
  /** Stack grouping id; series sharing one id stack together. */
  stackId?: string;
}

/** A single donut segment. */
export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Build `ChartLegend` items from a series list (labels + swatch colors). */
export function seriesToLegend(
  series: readonly ChartSeries[],
): ChartLegendItem[] {
  return series.map((s) => ({ label: s.label, color: s.color }));
}

/** Build `ChartLegend` items (with counts) from donut segments. */
export function segmentsToLegend(
  segments: readonly DonutSegment[],
  valueFormatter?: (value: number) => string,
): ChartLegendItem[] {
  return segments.map((s) => ({
    label: s.label,
    color: s.color,
    value: valueFormatter ? valueFormatter(s.value) : s.value,
  }));
}

/** Generic row shape accepted by the trend charts. `null` leaves a gap (e.g. a
 *  day with no cycle-time samples). */
export type ChartRow = Record<string, string | number | null>;
