'use client';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { formatDurationSeconds } from './format-duration';

interface MetricsSummaryCardsProps {
  total: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  failed: number;
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 px-5 py-4 first:pl-6 last:pr-6">
      <Text className="text-muted-foreground text-[13px] font-normal">
        {label}
      </Text>
      <Text className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </Text>
    </div>
  );
}

export function MetricsSummaryCards({
  total,
  successRate,
  avgExecutionTimeSeconds,
  failed,
}: MetricsSummaryCardsProps) {
  const { t } = useT('automations');
  const successRateDisplay = total > 0 ? `${successRate.toFixed(1)}%` : '—';

  return (
    <div className="border-border bg-card grid grid-cols-2 divide-y rounded-lg border md:grid-cols-4 md:divide-x md:divide-y-0">
      <StatCell
        label={t('metrics.cards.totalRuns')}
        value={formatNumber(total)}
      />
      <StatCell
        label={t('metrics.cards.successRate')}
        value={successRateDisplay}
      />
      <StatCell
        label={t('metrics.cards.avgDuration')}
        value={formatDurationSeconds(avgExecutionTimeSeconds)}
      />
      <StatCell
        label={t('metrics.cards.failedRuns')}
        value={formatNumber(failed)}
      />
    </div>
  );
}
