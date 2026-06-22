'use client';

import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { useSkeleton } from '@tale/ui/skeleton-context';

import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

export type UsageMetric = 'requests' | 'tokens' | 'cost';
export type UsageGranularity = 'daily' | 'weekly' | 'monthly';

// A type alias (not an interface) so it carries an implicit index signature and
// is assignable to the charts' `ChartRow` row type.
export type UsageSeriesPoint = {
  periodKey: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
};

interface UsageTrendChartProps {
  series: UsageSeriesPoint[];
  metric: UsageMetric;
  granularity: UsageGranularity;
}

function shortLabel(periodKey: string, granularity: UsageGranularity): string {
  if (granularity === 'monthly') return periodKey; // YYYY-MM
  return periodKey.slice(5); // daily YYYY-MM-DD → MM-DD, weekly → "Www"
}

export function UsageTrendChart({
  series,
  metric,
  granularity,
}: UsageTrendChartProps) {
  const { t } = useT('analytics');
  const loading = useSkeleton();

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

  return (
    <ChartCard
      title={t(`usage.metric.${metric}`)}
      loading={loading}
      bodyClassName="h-72"
      legend={
        metric === 'tokens' ? (
          <ChartLegend items={seriesToLegend(chartSeries)} />
        ) : undefined
      }
    >
      <TrendBarChart
        data={series}
        series={chartSeries}
        xKey="periodKey"
        xTickFormatter={(key) => shortLabel(key, granularity)}
        yTickFormatter={formatYTick}
        valueFormatter={metric === 'cost' ? formatCostCents : formatNumber}
      />
    </ChartCard>
  );
}
