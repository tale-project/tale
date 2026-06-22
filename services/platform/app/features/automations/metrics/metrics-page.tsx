'use client';

import { Alert } from '@tale/ui/alert';
import { Grid } from '@tale/ui/layout';
import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';

import { MetricSelect } from '@/app/components/metrics/metric-select';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
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
    api.workflow_executions.queries.getOrgWorkflowMetrics,
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
    <MetricsLayout
      className="p-6"
      title={t('metrics.title')}
      description={t('metrics.description')}
      toolbar={
        <MetricSelect
          aria-label={t('metrics.period.label')}
          options={periodOptions}
          value={String(periodDays)}
          onValueChange={(v) => {
            const next = Number(v);
            if (next === 7 || next === 30 || next === 90) onChangePeriod(next);
          }}
        />
      }
      notice={
        summary?.capped ? (
          <Alert
            variant="warning"
            icon={AlertTriangle}
            title={t('metrics.cappedNotice')}
          />
        ) : undefined
      }
    >
      <MetricsSummaryCards
        total={summary?.total ?? 0}
        successRate={summary?.successRate ?? 0}
        avgExecutionTimeSeconds={summary?.avgExecutionTimeSeconds ?? 0}
        failed={summary?.failed ?? 0}
        previous={data?.previousSummary}
      />

      <Grid lg={3}>
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
      </Grid>

      <TopWorkflowsTable
        organizationId={organizationId}
        rows={topWorkflows}
        isLoading={isLoading}
      />
    </MetricsLayout>
  );
}
