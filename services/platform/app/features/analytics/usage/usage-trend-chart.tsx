'use client';

import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';

import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

export type UsageMetric = 'requests' | 'tokens' | 'cost';
export type UsageGranularity = 'daily' | 'weekly' | 'monthly';

export interface UsageSeriesPoint {
  periodKey: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
}

interface UsageTrendChartProps {
  series: UsageSeriesPoint[];
  metric: UsageMetric;
  granularity: UsageGranularity;
}

/** Short axis label: monthly keeps `YYYY-MM`, weekly/daily drop the year. */
function shortLabel(periodKey: string, granularity: UsageGranularity): string {
  if (granularity === 'monthly') {
    return periodKey;
  }
  if (granularity === 'weekly') {
    return periodKey.slice(5);
  }
  return periodKey.slice(5);
}

export function UsageTrendChart({
  series,
  metric,
  granularity,
}: UsageTrendChartProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  const data = series.map((p) => ({
    ...p,
    label: shortLabel(p.periodKey, granularity),
  }));

  // An empty range (or a period with no activity for the active metric) would
  // otherwise render a bare, lopsided axis frame. Detect "nothing to plot" and
  // show an empty state instead.
  const hasData = (() => {
    if (metric === 'cost') return series.some((p) => p.costCents > 0);
    if (metric === 'requests') return series.some((p) => p.requests > 0);
    return series.some((p) => p.inputTokens > 0 || p.outputTokens > 0);
  })();

  const chartSeries: ChartSeries[] =
    metric === 'tokens'
      ? [
          {
            key: 'inputTokens',
            label: t('usage.chart.inputTokens'),
            color: CHART_COLORS.primary,
            stackId: 'tokens',
          },
          {
            key: 'outputTokens',
            label: t('usage.chart.outputTokens'),
            color: CHART_COLORS.success,
            stackId: 'tokens',
          },
        ]
      : metric === 'requests'
        ? [
            {
              key: 'requests',
              label: t('usage.metric.requests'),
              color: CHART_COLORS.primary,
            },
          ]
        : [
            {
              key: 'costCents',
              label: t('usage.metric.cost'),
              color: CHART_COLORS.warning,
            },
          ];

  const formatYTick = (value: number): string => {
    if (metric === 'cost') return formatCostCents(value);
    if (value >= 1000)
      return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    return String(value);
  };

  const valueFormatter = (value: number): string => {
    if (metric === 'cost') return formatCostCents(value);
    return formatNumber(value);
  };

  return (
    <ChartCard
      title={t(`usage.metric.${metric}`)}
      isEmpty={!hasData}
      emptyTitle={t('usage.empty.title')}
      emptyDescription={t('usage.empty.description')}
      legend={
        metric === 'tokens' ? (
          <ChartLegend items={seriesToLegend(chartSeries)} />
        ) : undefined
      }
    >
      <TrendBarChart
        data={data}
        series={chartSeries}
        xKey="label"
        yTickFormatter={formatYTick}
        valueFormatter={valueFormatter}
      />
    </ChartCard>
  );
}
