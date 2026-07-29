'use client';

import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { type ReactNode } from 'react';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import {
  formatDurationSeconds,
  formatSuccessRate,
} from '@/lib/utils/format/duration';

/** Prior equal-length window totals (from the query's `previousSummary`). */
interface PreviousSummary {
  total: number;
  successRate: number;
  avgDurationSeconds: number;
  failed: number;
}

interface AutomationSummaryCardsProps {
  total: number;
  successRate: number;
  avgDurationSeconds: number;
  failed: number;
  previous?: PreviousSummary;
}

function delta(node: ReactNode): ReactNode {
  return <div className="mt-0.5">{node}</div>;
}

export function AutomationSummaryCards({
  total,
  successRate,
  avgDurationSeconds,
  failed,
  previous,
}: AutomationSummaryCardsProps) {
  const { t } = useT('analytics');
  const { locale, formatNumber } = useFormatNumber();
  const successRateDisplay = formatSuccessRate(total, successRate, locale);

  return (
    <StatCardGrid>
      <StatCard
        label={t('automations.cards.totalRuns')}
        value={formatNumber(total)}
      >
        {delta(<TrendIndicator value={total} previous={previous?.total} />)}
      </StatCard>
      <StatCard
        label={t('automations.cards.successRate')}
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
        label={t('automations.cards.avgDuration')}
        value={formatDurationSeconds(avgDurationSeconds)}
      >
        {delta(
          <TrendIndicator
            value={avgDurationSeconds}
            previous={previous?.avgDurationSeconds}
            inverted
          />,
        )}
      </StatCard>
      <StatCard
        label={t('automations.cards.failedRuns')}
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
