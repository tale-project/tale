'use client';

import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Grid } from '@tale/ui/layout';
import { MetricsLayout } from '@tale/ui/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@tale/ui/metrics/metrics-period';
import { MetricsPeriodSelect } from '@tale/ui/metrics/metrics-period-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useRef, type ReactNode } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { readStateOf } from '@/app/lib/backend/read-state';
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
  readFailure?: ReactNode;
  unavailable: boolean;
  periodDays: MetricsPeriodDays;
  onPeriod: (value: string) => void;
  onSelectAutomation: (name: string) => void;
}

// =============================================================================
// Plain presentational view — no data hooks. Rendered both live (by the
// container) and as its own skeleton (wrapped in `<Skeletonize>`), so the
// loading and loaded layouts are the SAME tree and cannot drift.
// =============================================================================
function AutomationMetricsPageView({
  data,
  isLoading,
  readFailure,
  unavailable,
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
        readFailure || summary?.capped ? (
          <>
            {readFailure}
            {summary?.capped ? (
              <Alert
                variant="warning"
                icon={AlertTriangle}
                title={t('automations.cappedNotice')}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {unavailable ? null : (
        <>
          <AutomationSummaryCards
            total={summary?.total ?? 0}
            successRate={summary?.successRate ?? 0}
            avgDurationSeconds={summary?.avgDurationSeconds ?? 0}
            failed={summary?.failed ?? 0}
            previous={data?.previousSummary}
          />

          {/* Trend two-thirds, breakdown one-third once the metrics column is
          36rem wide — measured on the column, not the viewport, which also
          holds the rail and the settings panel. */}
          <div className="@container">
            <Grid className="@xl:grid-cols-3">
              <div className="@xl:col-span-2">
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
          </div>

          <TopAutomationsTable
            rows={topAutomations}
            isLoading={isLoading}
            onSelectAutomation={onSelectAutomation}
          />
        </>
      )}
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

  const metrics = useBackendQuery(
    'automations/queries:getOrgAutomationMetrics',
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );
  const { data, isLoading, refetch } = metrics;
  const read = readStateOf(metrics);
  const regionRef = useRef<HTMLDivElement>(null);
  const focusRegion = useCallback(() => regionRef.current?.focus(), []);
  const retry = useCallback(() => void refetch(), [refetch]);
  const failureMessage = [
    t(
      read.stale
        ? 'automations.errors.refreshFailed'
        : 'automations.errors.loadFailed',
    ),
    failureDetail(metrics.error),
  ]
    .filter(Boolean)
    .join(' ');

  const handlePeriod = useCallback(
    (value: string) => onChangePeriod(parseMetricsPeriodDays(value)),
    [onChangePeriod],
  );

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={t('automations.title')}
      tabIndex={-1}
      className="outline-none"
    >
      <Skeletonize
        loading={isLoading && !read.unavailable}
        label={t('automations.title')}
      >
        <AutomationMetricsPageView
          data={data}
          isLoading={isLoading}
          readFailure={
            read.unavailable || read.stale ? (
              <CatalogLoadError
                failureKey={read.failureCount}
                message={failureMessage}
                onRetry={retry}
                isRetrying={read.retrying}
                onFocusLost={focusRegion}
              />
            ) : undefined
          }
          unavailable={read.unavailable}
          periodDays={periodDays}
          onPeriod={handlePeriod}
          onSelectAutomation={onSelectAutomation}
        />
      </Skeletonize>
    </div>
  );
}
