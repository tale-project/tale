'use client';

import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { MetricsLayout } from '@tale/ui/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@tale/ui/metrics/metrics-period';
import { MetricsPeriodSelect } from '@tale/ui/metrics/metrics-period-select';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useRef, type ReactNode } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

export interface ExternalTurnMetricsPageProps {
  organizationId: string;
  periodDays: MetricsPeriodDays;
  onChangePeriod: (period: MetricsPeriodDays) => void;
}

type ExternalTurnMetrics =
  ReturnsOf<'sandbox/session_queries_public:getExternalTurnMetrics'>;

/** Rate (0..1 or null) as a percentage, or an em dash when there is nothing to
 * rate (no non-cancelled turns in the window). */
function ratePercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** ms → a compact seconds string; 0 stays "0s" so an empty window reads clean. */
function durationSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ViewProps {
  data: ExternalTurnMetrics | undefined;
  /** The failed read's alert, shown in the notices slot. */
  readFailure?: ReactNode;
  /** No figures were ever read: render none, not zero ones. */
  unavailable: boolean;
  periodDays: MetricsPeriodDays;
  onPeriod: (value: string) => void;
}

// Plain presentational view — rendered live AND as its own skeleton (wrapped in
// <Skeletonize>), so the loading and loaded layouts are the same tree.
function ExternalTurnMetricsPageView({
  data,
  readFailure,
  unavailable,
  periodDays,
  onPeriod,
}: ViewProps) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();

  const byHarness = data?.byHarness ?? [];

  return (
    <MetricsLayout
      as="h3"
      title={t('externalTurns.title')}
      description={t('externalTurns.description')}
      toolbar={
        <MetricsPeriodSelect
          value={String(periodDays)}
          onValueChange={onPeriod}
        />
      }
      notice={
        readFailure || data?.capped ? (
          <>
            {readFailure}
            {data?.capped ? (
              <Alert
                variant="warning"
                icon={AlertTriangle}
                title={t('externalTurns.cappedNotice')}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {unavailable ? null : (
        <>
          <StatCardGrid cols={3}>
            <StatCard
              label={t('externalTurns.cards.total')}
              value={formatNumber(data?.total ?? 0)}
            />
            <StatCard
              label={t('externalTurns.cards.successRate')}
              value={ratePercent(data?.successRate)}
            />
            <StatCard
              label={t('externalTurns.cards.timeoutRate')}
              value={ratePercent(data?.timeoutRate)}
            />
            <StatCard
              label={t('externalTurns.cards.durationP95')}
              value={durationSeconds(data?.durationP95Ms ?? 0)}
            />
            <StatCard
              label={t('externalTurns.cards.cancelled')}
              value={formatNumber(data?.cancelled ?? 0)}
            />
            <StatCard
              label={t('externalTurns.cards.recovered')}
              value={formatNumber(data?.recovered ?? 0)}
            />
          </StatCardGrid>

          <div>
            <Text as="div" variant="label" className="mb-2">
              {t('externalTurns.byHarness.title')}
            </Text>
            {byHarness.length === 0 ? (
              // Masked while the first read runs: the empty-period line is
              // an answer, so it stays out of sight until one arrives.
              <Text variant="muted">
                <SkeletonBox>{t('externalTurns.byHarness.empty')}</SkeletonBox>
              </Text>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t('externalTurns.byHarness.harness')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('externalTurns.byHarness.turns')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('externalTurns.byHarness.successRate')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('externalTurns.byHarness.timeouts')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byHarness.map((row) => (
                    <TableRow key={row.harness}>
                      <TableCell>{row.harness}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.total)}
                      </TableCell>
                      <TableCell className="text-right">
                        {ratePercent(row.successRate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.timeout)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </MetricsLayout>
  );
}

// Container — owns the metrics query.
export function ExternalTurnMetricsPage({
  organizationId,
  periodDays,
  onChangePeriod,
}: ExternalTurnMetricsPageProps) {
  const { t } = useT('analytics');

  const metrics = useBackendQuery(
    'sandbox/session_queries_public:getExternalTurnMetrics',
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );
  const { data, isLoading, refetch } = metrics;
  // A failed read is named, never passed off as a period with no turns
  // (#3868): the flags hold through a retry, which react-query starts from
  // `pending`.
  const read = readStateOf(metrics);
  // Where a Try again that worked hands its focus as the notice goes: the
  // page's region, around the figures it brought back.
  const regionRef = useRef<HTMLDivElement>(null);
  const focusRegion = useCallback(() => regionRef.current?.focus(), []);
  const retry = useCallback(() => void refetch(), [refetch]);
  const failureMessage = [
    t(
      read.stale
        ? 'externalTurns.errors.refreshFailed'
        : 'externalTurns.errors.loadFailed',
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
      aria-label={t('externalTurns.title')}
      tabIndex={-1}
      className="outline-none"
    >
      {/* A failed read that is being retried stays named, with its Try
          again busy, rather than turning back into the skeleton. */}
      <Skeletonize
        loading={isLoading && !read.unavailable}
        label={t('externalTurns.title')}
      >
        <ExternalTurnMetricsPageView
          data={data ?? undefined}
          readFailure={
            read.unavailable || read.stale ? (
              <CatalogLoadError
                // Each failure is announced again; Try again keeps its node,
                // and the focus on it, through a retry that fails again.
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
        />
      </Skeletonize>
    </div>
  );
}
