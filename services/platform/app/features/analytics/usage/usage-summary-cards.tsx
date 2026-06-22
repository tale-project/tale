'use client';

import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Info } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

interface UsageSummaryCardsProps {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
}

export function UsageSummaryCards({
  totalRequests,
  totalTokens,
  totalCostCents,
  activeUsers,
}: UsageSummaryCardsProps) {
  const { t } = useT('analytics');

  return (
    <StatCardGrid>
      <StatCard
        label={t('usage.cards.totalRequests')}
        value={formatNumber(totalRequests)}
        loadingWidth="w-20"
      />
      <StatCard
        label={t('usage.cards.totalTokens')}
        value={formatNumber(totalTokens)}
        loadingWidth="w-20"
      />
      <StatCard
        label={t('usage.cards.totalCost')}
        value={formatCostCents(totalCostCents)}
        loadingWidth="w-20"
      />
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
      />
    </StatCardGrid>
  );
}
