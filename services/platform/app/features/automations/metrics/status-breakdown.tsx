'use client';

import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { Clock } from 'lucide-react';

import {
  DonutChart,
  segmentsToLegend,
  type DonutSegment,
} from '@/app/components/metrics/charts';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

interface StatusBreakdownProps {
  completed: number;
  failed: number;
  running: number;
  pending: number;
}

export function StatusBreakdown({
  completed,
  failed,
  running,
  pending,
}: StatusBreakdownProps) {
  const { t } = useT('automations');
  // Include pending so the donut center agrees with the "Total runs" KPI, which
  // counts every in-window run regardless of status.
  const total = completed + failed + running + pending;

  const segments: DonutSegment[] = [
    {
      key: 'completed',
      label: t('metrics.chart.completed'),
      value: completed,
      color: CHART_COLORS.success,
    },
    {
      key: 'failed',
      label: t('metrics.chart.failed'),
      value: failed,
      color: CHART_COLORS.failure,
    },
    {
      key: 'running',
      label: t('metrics.chart.running'),
      value: running,
      color: CHART_COLORS.neutral,
    },
    {
      key: 'pending',
      label: t('metrics.chart.pending'),
      value: pending,
      color: CHART_COLORS.warning,
    },
  ];

  return (
    <ChartCard
      title={t('metrics.chart.statusTitle')}
      tooltip={t('metrics.chart.statusTooltip')}
      bodyClassName="h-48"
      isEmpty={total === 0}
      emptyIcon={Clock}
      emptyTitle={t('metrics.chart.noData')}
      emptyDescription={t('metrics.chart.noDataDescription')}
      legend={<ChartLegend items={segmentsToLegend(segments, formatNumber)} />}
    >
      <DonutChart
        segments={segments}
        valueFormatter={formatNumber}
        centerValue={formatNumber(total)}
        centerLabel={t('metrics.chart.totalLabel')}
      />
    </ChartCard>
  );
}
