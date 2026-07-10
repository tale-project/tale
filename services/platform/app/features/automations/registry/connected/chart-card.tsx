'use client';

/**
 * Connected `ChartCard` block — binds an allowlisted query and renders its
 * datapoints as a trend chart: `itemsKey` (dot-notation) extracts the row
 * array (default: the result itself when it IS an array), `chart.kind` picks
 * the shared recharts wrapper (`TrendLineChart`/`TrendAreaChart`/
 * `TrendBarChart`), series colors come from the chart-theme categorical
 * palette, and multi-series charts get a `ChartLegend`.
 *
 * Framing deviation from the other connected blocks: the `@tale/ui` ChartCard
 * IS the frame here (title + fixed-height body + loading/empty machinery map
 * 1:1), so there is no `BlockFrame` — wrapping one card in another would
 * double the chrome. `BindingStates` still owns the binding states, rendered
 * as the card's body.
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { ChartCard as UiChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { getChartSeriesColor } from '@tale/ui/chart-theme';
import { BarChart3 } from 'lucide-react';

import {
  seriesToLegend,
  TrendAreaChart,
  TrendBarChart,
  TrendLineChart,
  type ChartRow,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { useT } from '@/lib/i18n/client';
import {
  argsReferenceProjectId,
  argsReferenceViewState,
} from '@/lib/shared/platform/function_bindings';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { BindingStates } from '../block-frame';
import { getValueAtPath } from './stat-grid';

export interface ChartSeriesSpec {
  /** Dot-notation path to the numeric value in each row. */
  field: string;
  /** Literal display label, rendered verbatim. */
  labelKey: string;
}

export interface ChartSpec {
  kind: 'line' | 'area' | 'bar';
  /** Dot-notation path to the x value in each row. */
  xField: string;
  series: ChartSeriesSpec[];
}

export interface ChartCardBlockProps {
  /** Literal card title, rendered verbatim. */
  titleKey: string;
  query: { path: string; args?: unknown };
  /** Result key (dot-notation) holding the datapoint array. */
  itemsKey?: string;
  chart: ChartSpec;
  /** Chart body height in px (default: the ChartCard `h-60`). */
  height?: number;
}

/** Extract the row array from the bound result (null-tolerant). */
export function extractChartRows(
  data: unknown,
  itemsKey: string | undefined,
): Record<string, unknown>[] {
  const raw = itemsKey ? getValueAtPath(data, itemsKey) : data;
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

/**
 * Flatten rows onto sanitized keys (`x`, `s0`, `s1`, …) so a dot-notation
 * `field` never collides with recharts' own nested-path `dataKey` lookup.
 * Non-numeric series values become `null` (a gap, not a crash).
 */
function toChartRows(
  rows: Record<string, unknown>[],
  chart: ChartSpec,
): ChartRow[] {
  return rows.map((row) => {
    const x = getValueAtPath(row, chart.xField);
    const out: ChartRow = {
      x: typeof x === 'string' || typeof x === 'number' ? x : '',
    };
    chart.series.forEach((s, i) => {
      const v = getValueAtPath(row, s.field);
      out[`s${i}`] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    });
    return out;
  });
}

export function ChartCard({
  titleKey,
  query,
  itemsKey,
  chart,
  height,
}: ChartCardBlockProps) {
  const { t } = useT('automations');
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    query.path,
    query.args,
  );
  const awaitingState = needsConfig && argsReferenceViewState(query.args);
  const needsProject =
    needsConfig && !awaitingState && argsReferenceProjectId(query.args);
  const hasBindingState = blocked || needsConfig;

  const rows = extractChartRows(data, itemsKey);
  const chartRows = toChartRows(rows, chart);
  const series: ChartSeries[] = chart.series.map((s, i) => ({
    key: `s${i}`,
    label: s.labelKey,
    color: getChartSeriesColor(i),
  }));

  const body =
    chart.kind === 'line' ? (
      <TrendLineChart data={chartRows} series={series} xKey="x" />
    ) : chart.kind === 'bar' ? (
      <TrendBarChart data={chartRows} series={series} xKey="x" />
    ) : (
      <TrendAreaChart data={chartRows} series={series} xKey="x" />
    );

  return (
    <UiChartCard
      title={titleKey}
      loading={isLoading && !hasBindingState}
      isEmpty={!isLoading && !hasBindingState && rows.length === 0}
      emptyIcon={BarChart3}
      // The ui ChartCard's empty state defaults its heading to `title`, which
      // would render the card title TWICE (header + empty state) — pass the
      // shared binding empty copy instead (BindingStates' `binding.empty`).
      emptyTitle={t('binding.empty')}
      // `height` is authored data (px) — the default stays the ChartCard's own
      // `h-60` class; an explicit height moves onto an inner style so Tailwind
      // never sees a dynamic class.
      bodyClassName={height === undefined ? undefined : ''}
      legend={
        series.length > 1 && !hasBindingState && rows.length > 0 ? (
          <ChartLegend items={seriesToLegend(series)} />
        ) : undefined
      }
    >
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaitingState && !needsProject}
        needsProject={needsProject}
        awaitingState={awaitingState}
      >
        <div
          className="size-full"
          style={height === undefined ? undefined : { height }}
        >
          {body}
        </div>
      </BindingStates>
    </UiChartCard>
  );
}

/** Registry entry (`registerConnectedBlock('ChartCard', chartCardBlock)`). */
export const chartCardBlock: {
  fields: Fields;
  render: PuckComponent<Partial<ChartCardBlockProps>>;
} = {
  fields: { titleKey: { type: 'text' } },
  render: ({ titleKey, query, itemsKey, chart, height }) =>
    titleKey !== undefined &&
    query?.path &&
    chart?.xField &&
    chart.series &&
    chart.series.length > 0 ? (
      <ChartCard
        titleKey={titleKey}
        query={query}
        itemsKey={itemsKey}
        chart={chart}
        height={height}
      />
    ) : (
      <></>
    ),
};
