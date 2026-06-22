'use client';

import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';

import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { formatDurationSeconds, formatSuccessRate } from './format-duration';

interface MetricsSummaryCardsProps {
  total: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  failed: number;
}

export function MetricsSummaryCards({
  total,
  successRate,
  avgExecutionTimeSeconds,
  failed,
}: MetricsSummaryCardsProps) {
  const { t } = useT('automations');
  const successRateDisplay = formatSuccessRate(total, successRate);

  return (
    <StatCardGrid>
      <StatCard
        label={t('metrics.cards.totalRuns')}
        value={formatNumber(total)}
      />
      <StatCard
        label={t('metrics.cards.successRate')}
        value={successRateDisplay}
      />
      <StatCard
        label={t('metrics.cards.avgDuration')}
        value={formatDurationSeconds(avgExecutionTimeSeconds)}
      />
      <StatCard
        label={t('metrics.cards.failedRuns')}
        value={formatNumber(failed)}
      />
    </StatCardGrid>
  );
}
