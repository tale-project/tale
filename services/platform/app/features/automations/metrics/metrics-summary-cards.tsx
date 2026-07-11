'use client';

import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { formatDurationSeconds, formatSuccessRate } from './format-duration';

/** Prior equal-length window totals (from the query's `previousSummary`). */
interface PreviousSummary {
  total: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  failed: number;
}

interface MetricsSummaryCardsProps {
  total: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  failed: number;
  previous?: PreviousSummary;
}

function delta(node: ReactNode): ReactNode {
  return <div className="mt-0.5">{node}</div>;
}

export function MetricsSummaryCards({
  total,
  successRate,
  avgExecutionTimeSeconds,
  failed,
  previous,
}: MetricsSummaryCardsProps) {
  const { t } = useT('automations');
  const successRateDisplay = formatSuccessRate(total, successRate);

  return (
    <StatCardGrid>
      <StatCard
        label={t('metrics.cards.totalRuns')}
        value={formatNumber(total)}
      >
        {delta(<TrendIndicator value={total} previous={previous?.total} />)}
      </StatCard>
      <StatCard
        label={t('metrics.cards.successRate')}
        value={successRateDisplay}
      >
        {delta(
          <TrendIndicator
            value={successRate}
            previous={previous?.successRate}
          />,
        )}
      </StatCard>
      <StatCard
        label={t('metrics.cards.avgDuration')}
        value={formatDurationSeconds(avgExecutionTimeSeconds)}
      >
        {delta(
          <TrendIndicator
            value={avgExecutionTimeSeconds}
            previous={previous?.avgExecutionTimeSeconds}
            inverted
          />,
        )}
      </StatCard>
      <StatCard
        label={t('metrics.cards.failedRuns')}
        value={formatNumber(failed)}
      >
        {delta(
          <TrendIndicator
            value={failed}
            previous={previous?.failed}
            inverted
          />,
        )}
      </StatCard>
    </StatCardGrid>
  );
}
