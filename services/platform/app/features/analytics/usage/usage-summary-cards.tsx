'use client';

import { Info } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

interface UsageSummaryCardsProps {
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  activeUsers: number;
}

interface StatCardProps {
  label: string;
  value: string;
  tooltip?: string;
}

function StatCard({ label, value, tooltip }: StatCardProps) {
  const labelNode = (
    <Text className="text-muted-foreground text-xs">
      {label}
      {tooltip ? (
        <Info className="ml-1 inline-block size-3 align-text-bottom" />
      ) : null}
    </Text>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {tooltip ? (
        <Tooltip content={tooltip}>
          <button type="button" className="text-left">
            {labelNode}
          </button>
        </Tooltip>
      ) : (
        labelNode
      )}
      <Text className="font-mono text-lg font-semibold">{value}</Text>
    </div>
  );
}

export function UsageSummaryCards({
  totalRequests,
  totalTokens,
  totalCostCents,
  activeUsers,
}: UsageSummaryCardsProps) {
  const { t } = useT('analytics');

  return (
    <div className="border-border grid grid-cols-2 gap-8 rounded-lg border px-5 py-3 md:grid-cols-4">
      <StatCard
        label={t('usage.cards.totalRequests')}
        value={formatNumber(totalRequests)}
      />
      <StatCard
        label={t('usage.cards.totalTokens')}
        value={formatNumber(totalTokens)}
      />
      <StatCard
        label={t('usage.cards.totalCost')}
        value={formatCostCents(totalCostCents)}
      />
      <StatCard
        label={t('usage.cards.activeUsers')}
        value={formatNumber(activeUsers)}
        tooltip={t('usage.activeUsersTooltip')}
      />
    </div>
  );
}
