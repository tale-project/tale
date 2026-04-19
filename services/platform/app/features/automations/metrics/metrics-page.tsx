'use client';

import { useMemo } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { ExecutionTrendChart } from './execution-trend-chart';
import { MetricsSummaryCards } from './metrics-summary-cards';
import { StatusBreakdown } from './status-breakdown';
import { TopWorkflowsTable } from './top-workflows-table';

export type PeriodDays = 7 | 30 | 90;

interface WorkflowMetricsPageProps {
  organizationId: string;
  periodDays: PeriodDays;
  onChangePeriod: (period: PeriodDays) => void;
}

export function WorkflowMetricsPage({
  organizationId,
  periodDays,
  onChangePeriod,
}: WorkflowMetricsPageProps) {
  const { t } = useT('automations');

  const { data, isLoading } = useConvexQuery(
    api.wf_executions.queries.getOrgWorkflowMetrics,
    { organizationId, periodDays },
  );

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('metrics.period.last7Days') },
      { value: '30', label: t('metrics.period.last30Days') },
      { value: '90', label: t('metrics.period.last90Days') },
    ],
    [t],
  );

  const summary = data?.summary;
  const series = data?.series ?? [];
  const topWorkflows = data?.topWorkflows ?? [];

  return (
    <Stack gap={4} className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Text as="h3" variant="label" className="text-lg font-semibold">
            {t('metrics.title')}
          </Text>
          <Text variant="caption">{t('metrics.description')}</Text>
        </div>
        <div className="w-44">
          <Select
            options={periodOptions}
            value={String(periodDays)}
            onValueChange={(v) => {
              const next = Number(v);
              if (next === 7 || next === 30 || next === 90)
                onChangePeriod(next);
            }}
            size="sm"
          />
        </div>
      </div>

      {summary?.capped ? (
        <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
          {t('metrics.cappedNotice')}
        </div>
      ) : null}

      <MetricsSummaryCards
        total={summary?.total ?? 0}
        successRate={summary?.successRate ?? 0}
        avgExecutionTimeSeconds={summary?.avgExecutionTimeSeconds ?? 0}
        failed={summary?.failed ?? 0}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ExecutionTrendChart series={series} />
        </div>
        <div>
          <StatusBreakdown
            completed={summary?.completed ?? 0}
            failed={summary?.failed ?? 0}
            running={summary?.running ?? 0}
          />
        </div>
      </div>

      <TopWorkflowsTable
        organizationId={organizationId}
        rows={topWorkflows}
        isLoading={isLoading}
      />
    </Stack>
  );
}
