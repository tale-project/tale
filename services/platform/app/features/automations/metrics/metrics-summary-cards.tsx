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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text className="text-muted-foreground text-xs">{label}</Text>
      <Text className="font-mono text-lg font-semibold">{value}</Text>
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
    <div className="border-border grid grid-cols-2 gap-8 rounded-lg border px-5 py-3 md:grid-cols-4">
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
    </div>
  );
}
