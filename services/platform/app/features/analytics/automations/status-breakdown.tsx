'use client';

import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS, CHART_SERIES } from '@tale/ui/chart-theme';
import { Clock } from 'lucide-react';

import {
  DonutChart,
  segmentsToLegend,
  type DonutSegment,
} from '@/app/components/metrics/charts';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

interface StatusBreakdownProps {
  success: number;
  failed: number;
  running: number;
  waiting: number;
  queued: number;
  cancelled: number;
}

export function StatusBreakdown({
  success,
  failed,
  running,
  waiting,
  queued,
  cancelled,
}: StatusBreakdownProps) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();
  // Every status is included so the donut center agrees with the "Total runs"
  // KPI, which counts every in-window run regardless of outcome.
  const total = success + failed + running + waiting + queued + cancelled;

  const segments: DonutSegment[] = [
    {
      key: 'success',
      label: t('automations.chart.success'),
      value: success,
      color: CHART_COLORS.success,
    },
    {
      key: 'failed',
      label: t('automations.chart.failed'),
      value: failed,
      color: CHART_COLORS.failure,
    },
    {
      key: 'running',
      label: t('automations.chart.running'),
      value: running,
      color: CHART_COLORS.neutral,
    },
    {
      key: 'waiting',
      label: t('automations.chart.waiting'),
      value: waiting,
      color: CHART_COLORS.warning,
    },
    {
      key: 'queued',
      label: t('automations.chart.queued'),
      value: queued,
      color: CHART_COLORS.primary,
    },
    {
      key: 'cancelled',
      label: t('automations.chart.cancelled'),
      value: cancelled,
      color: CHART_SERIES[2],
    },
  ];

  return (
    <ChartCard
      title={t('automations.chart.statusTitle')}
      tooltip={t('automations.chart.statusTooltip')}
      bodyClassName="h-48"
      isEmpty={total === 0}
      emptyIcon={Clock}
      emptyTitle={t('automations.chart.noData')}
      emptyDescription={t('automations.chart.noDataDescription')}
      legend={<ChartLegend items={segmentsToLegend(segments, formatNumber)} />}
    >
      <DonutChart
        segments={segments}
        valueFormatter={formatNumber}
        centerValue={formatNumber(total)}
        centerLabel={t('automations.chart.totalLabel')}
      />
    </ChartCard>
  );
}
