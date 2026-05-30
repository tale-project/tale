'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
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

interface StatCellProps {
  label: string;
  value: string;
  tooltip?: string;
}

function StatCell({ label, value, tooltip }: StatCellProps) {
  const loading = useSkeleton();
  const labelNode = (
    <Text className="text-muted-foreground text-sm">
      {label}
      {tooltip ? (
        <Info className="ml-1 inline-block size-3 align-text-bottom" />
      ) : null}
    </Text>
  );

  return (
    <div className="flex flex-1 flex-col gap-1 p-5">
      {tooltip ? (
        <Tooltip content={tooltip}>
          <button type="button" className="text-left">
            {labelNode}
          </button>
        </Tooltip>
      ) : (
        labelNode
      )}
      {/* The metric value arrives async — mask it to its natural line box
          (font-mono text-2xl) so the card height is identical loading vs
          loaded and the number doesn't flash from a placeholder 0. */}
      <Text className="text-foreground font-mono text-2xl font-semibold">
        {loading ? <SkeletonBox className="my-0.5 h-7 w-20" /> : value}
      </Text>
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
    <div className="border-border divide-border grid grid-cols-2 divide-y rounded-lg border md:grid-cols-4 md:divide-x md:divide-y-0">
      <StatCell
        label={t('usage.cards.totalRequests')}
        value={formatNumber(totalRequests)}
      />
      <StatCell
        label={t('usage.cards.totalTokens')}
        value={formatNumber(totalTokens)}
      />
      <StatCell
        label={t('usage.cards.totalCost')}
        value={formatCostCents(totalCostCents)}
      />
      <StatCell
        label={t('usage.cards.activeUsers')}
        value={formatNumber(activeUsers)}
        tooltip={t('usage.activeUsersTooltip')}
      />
    </div>
  );
}
