'use client';

import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';

import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { useT } from '@/lib/i18n/client';

// A type alias (not an interface) so it carries an implicit index signature and
// is assignable to the charts' `ChartRow` row type.
type TrendPoint = {
  dateKey: string;
  completed: number;
  failed: number;
};

interface ExecutionTrendChartProps {
  series: TrendPoint[];
}

/** Short axis label `06-13` from a `2026-06-13` date key (tooltip keeps full). */
function shortLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${month}-${day}`;
}

export function ExecutionTrendChart({ series }: ExecutionTrendChartProps) {
  const { t } = useT('automations');

  const chartSeries: ChartSeries[] = [
    {
      key: 'completed',
      label: t('metrics.chart.completed'),
      color: CHART_COLORS.success,
      stackId: 'runs',
    },
    {
      key: 'failed',
      label: t('metrics.chart.failed'),
      color: CHART_COLORS.failure,
      stackId: 'runs',
    },
  ];

  const isEmpty = series.every((p) => !p.completed && !p.failed);

  return (
    <ChartCard
      title={t('metrics.chart.trendTitle')}
      tooltip={t('metrics.chart.trendTooltip')}
      isEmpty={isEmpty}
      emptyTitle={t('metrics.chart.noData')}
      emptyDescription={t('metrics.chart.noDataDescription')}
      legend={<ChartLegend items={seriesToLegend(chartSeries)} />}
    >
      <TrendBarChart
        data={series}
        series={chartSeries}
        xKey="dateKey"
        xTickFormatter={shortLabel}
      />
    </ChartCard>
  );
}
