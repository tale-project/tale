'use client';

import { Alert } from '@tale/ui/alert';
import { Grid } from '@tale/ui/layout';
import { AlertTriangle } from 'lucide-react';

import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { ExecutionTrendChart } from './execution-trend-chart';
import { MetricsSummaryCards } from './metrics-summary-cards';
import { StatusBreakdown } from './status-breakdown';
import { TopWorkflowsTable } from './top-workflows-table';

interface WorkflowMetricsPageProps {
  organizationId: string;
  periodDays: MetricsPeriodDays;
  onChangePeriod: (period: MetricsPeriodDays) => void;
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

  const summary = data?.summary;
  const series = data?.series ?? [];
  const topWorkflows = data?.topWorkflows ?? [];

  return (
    <MetricsLayout
      as="h3"
      title={t('metrics.title')}
      description={t('metrics.description')}
      toolbar={
        <MetricsPeriodSelect
          value={String(periodDays)}
          onValueChange={(v) => onChangePeriod(parseMetricsPeriodDays(v))}
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
            pending={Math.max(
              0,
              (summary?.total ?? 0) -
                (summary?.completed ?? 0) -
                (summary?.failed ?? 0) -
                (summary?.running ?? 0),
            )}
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
