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
  success: number;
  failed: number;
  running: number;
};

interface RunTrendChartProps {
  series: TrendPoint[];
}

/** Short axis label `06-13` from a `2026-06-13` date key (tooltip keeps full). */
function shortLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${month}-${day}`;
}

export function RunTrendChart({ series }: RunTrendChartProps) {
  const { t } = useT('analytics');

  const chartSeries: ChartSeries[] = [
    {
      key: 'success',
      label: t('automations.chart.success'),
      color: CHART_COLORS.success,
      stackId: 'runs',
    },
    {
      key: 'failed',
      label: t('automations.chart.failed'),
      color: CHART_COLORS.failure,
      stackId: 'runs',
    },
    {
      key: 'running',
      label: t('automations.chart.running'),
      color: CHART_COLORS.neutral,
      stackId: 'runs',
    },
  ];

  const isEmpty = series.every((p) => !p.success && !p.failed && !p.running);

  return (
    <ChartCard
      title={t('automations.chart.trendTitle')}
      tooltip={t('automations.chart.trendTooltip')}
      isEmpty={isEmpty}
      emptyTitle={t('automations.chart.noData')}
      emptyDescription={t('automations.chart.noDataDescription')}
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
