'use client';

import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { Info } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

/** Prior equal-length window totals (from the query's `previousSummary`). */
interface PreviousSummary {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
}

interface UsageSummaryCardsProps {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
  previous?: PreviousSummary;
}

export function UsageSummaryCards({
  totalRequests,
  totalTokens,
  totalCostCents,
  activeUsers,
  previous,
}: UsageSummaryCardsProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  return (
    <StatCardGrid>
      <StatCard
        label={t('usage.cards.totalRequests')}
        value={formatNumber(totalRequests)}
        loadingWidth="w-20"
      >
        <div className="mt-0.5">
          <TrendIndicator
            value={totalRequests}
            previous={previous?.totalRequests}
          />
        </div>
      </StatCard>
      <StatCard
        label={t('usage.cards.totalTokens')}
        value={formatNumber(totalTokens)}
        loadingWidth="w-20"
      >
        <div className="mt-0.5">
          <TrendIndicator
            value={totalTokens}
            previous={previous?.totalTokens}
          />
        </div>
      </StatCard>
      <StatCard
        label={t('usage.cards.totalCost')}
        value={formatCostCents(totalCostCents)}
        loadingWidth="w-20"
      >
        <div className="mt-0.5">
          <TrendIndicator
            value={totalCostCents}
            previous={previous?.totalCostCents}
            inverted
          />
        </div>
      </StatCard>
      <StatCard
        label={t('usage.cards.activeUsers')}
        value={formatNumber(activeUsers)}
        loadingWidth="w-20"
        tooltip={
          <Tooltip content={t('usage.activeUsersTooltip')}>
            <button
              type="button"
              className="align-text-bottom"
              aria-label={t('usage.activeUsersTooltip')}
            >
              <Info className="ml-1 inline-block size-3" />
            </button>
          </Tooltip>
        }
      >
        <div className="mt-0.5">
          <TrendIndicator
            value={activeUsers}
            previous={previous?.activeUsers}
          />
        </div>
      </StatCard>
    </StatCardGrid>
  );
}
