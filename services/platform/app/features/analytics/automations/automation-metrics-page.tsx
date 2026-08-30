'use client';

import { Alert } from '@tale/ui/alert';
import { Grid } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertTriangle } from 'lucide-react';
import { useCallback } from 'react';

import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { AutomationSummaryCards } from './automation-summary-cards';
import { RunTrendChart } from './run-trend-chart';
import { StatusBreakdown } from './status-breakdown';
import { TopAutomationsTable } from './top-automations-table';

export interface AutomationMetricsPageProps {
  organizationId: string;
  periodDays: MetricsPeriodDays;
  onChangePeriod: (period: MetricsPeriodDays) => void;
  /** Row click in the top-automations table → the automation's detail page. */
  onSelectAutomation: (name: string) => void;
}

type AutomationMetricsData =
  | ReturnsOf<'automations/queries:getOrgAutomationMetrics'>
  | undefined;

interface AutomationMetricsPageViewProps {
  /** Resolved metrics payload; `undefined` while loading (masked by the
   *  enclosing `<Skeletonize>` — cards/charts/table stand in at full height). */
  data: AutomationMetricsData;
  isLoading: boolean;
  periodDays: MetricsPeriodDays;
  onPeriod: (value: string) => void;
  onSelectAutomation: (name: string) => void;
}

// =============================================================================
// Plain presentational view — no data hooks. Rendered both live (by the
// container) and as its own skeleton (wrapped in `<Skeletonize>`), so the
// loading and loaded layouts are the SAME tree and cannot drift.
// =============================================================================
export function AutomationMetricsPageView({
  data,
  isLoading,
  periodDays,
  onPeriod,
  onSelectAutomation,
}: AutomationMetricsPageViewProps) {
  const { t } = useT('analytics');

  const summary = data?.summary;
  const series = data?.series ?? [];
  const topAutomations = data?.topAutomations ?? [];

  return (
    <MetricsLayout
      as="h3"
      title={t('automations.title')}
      description={t('automations.description')}
      toolbar={
        <MetricsPeriodSelect
          value={String(periodDays)}
          onValueChange={onPeriod}
        />
      }
      notice={
        summary?.capped ? (
          <Alert
            variant="warning"
            icon={AlertTriangle}
            title={t('automations.cappedNotice')}
          />
        ) : undefined
      }
    >
      <AutomationSummaryCards
        total={summary?.total ?? 0}
        successRate={summary?.successRate ?? 0}
        avgDurationSeconds={summary?.avgDurationSeconds ?? 0}
        failed={summary?.failed ?? 0}
        previous={data?.previousSummary}
      />

      <Grid lg={3}>
        <div className="lg:col-span-2">
          <RunTrendChart series={series} />
        </div>
        <div>
          <StatusBreakdown
            success={summary?.success ?? 0}
            failed={summary?.failed ?? 0}
            running={summary?.running ?? 0}
            waiting={summary?.waiting ?? 0}
            queued={summary?.queued ?? 0}
            cancelled={summary?.cancelled ?? 0}
          />
        </div>
      </Grid>

      <TopAutomationsTable
        rows={topAutomations}
        isLoading={isLoading}
        onSelectAutomation={onSelectAutomation}
      />
    </MetricsLayout>
  );
}

// =============================================================================
// Container — owns the metrics query. Wraps the plain view in `<Skeletonize>`
// so the same tree renders the skeleton while the metrics load (no separate
// skeleton file to drift from the real layout).
// =============================================================================
export function AutomationMetricsPage({
  organizationId,
  periodDays,
  onChangePeriod,
  onSelectAutomation,
}: AutomationMetricsPageProps) {
  const { t } = useT('analytics');

  const { data, isLoading } = useConvexQuery(
    'automations/queries:getOrgAutomationMetrics',
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );

  const handlePeriod = useCallback(
    (value: string) => onChangePeriod(parseMetricsPeriodDays(value)),
    [onChangePeriod],
  );

  return (
    <Skeletonize loading={isLoading} label={t('automations.title')}>
      <AutomationMetricsPageView
        data={data}
        isLoading={isLoading}
        periodDays={periodDays}
        onPeriod={handlePeriod}
        onSelectAutomation={onSelectAutomation}
      />
    </Skeletonize>
  );
}
