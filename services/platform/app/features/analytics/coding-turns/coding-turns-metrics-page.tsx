'use client';

import { Alert } from '@tale/ui/alert';
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
import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle } from 'lucide-react';
import { useCallback } from 'react';

import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export interface CodingTurnMetricsPageProps {
  organizationId: string;
  periodDays: MetricsPeriodDays;
  onChangePeriod: (period: MetricsPeriodDays) => void;
}

type CodingTurnMetrics = FunctionReturnType<
  typeof api.sandbox.session_queries_public.getCodingTurnMetrics
>;

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
  data: CodingTurnMetrics | undefined;
  periodDays: MetricsPeriodDays;
  onPeriod: (value: string) => void;
}

// Plain presentational view — rendered live AND as its own skeleton (wrapped in
// <Skeletonize>), so the loading and loaded layouts are the same tree.
export function CodingTurnMetricsPageView({
  data,
  periodDays,
  onPeriod,
}: ViewProps) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();

  const byHarness = data?.byHarness ?? [];

  return (
    <MetricsLayout
      as="h3"
      title={t('codingTurns.title')}
      description={t('codingTurns.description')}
      toolbar={
        <MetricsPeriodSelect
          value={String(periodDays)}
          onValueChange={onPeriod}
        />
      }
      notice={
        data?.capped ? (
          <Alert
            variant="warning"
            icon={AlertTriangle}
            title={t('codingTurns.cappedNotice')}
          />
        ) : undefined
      }
    >
      <StatCardGrid>
        <StatCard
          label={t('codingTurns.cards.total')}
          value={formatNumber(data?.total ?? 0)}
        />
        <StatCard
          label={t('codingTurns.cards.successRate')}
          value={ratePercent(data?.successRate)}
        />
        <StatCard
          label={t('codingTurns.cards.timeoutRate')}
          value={ratePercent(data?.timeoutRate)}
        />
        <StatCard
          label={t('codingTurns.cards.durationP95')}
          value={durationSeconds(data?.durationP95Ms ?? 0)}
        />
        <StatCard
          label={t('codingTurns.cards.cancelled')}
          value={formatNumber(data?.cancelled ?? 0)}
        />
        <StatCard
          label={t('codingTurns.cards.recovered')}
          value={formatNumber(data?.recovered ?? 0)}
        />
      </StatCardGrid>

      <div>
        <Text as="div" variant="label" className="mb-2">
          {t('codingTurns.byHarness.title')}
        </Text>
        {byHarness.length === 0 ? (
          <Text variant="muted">{t('codingTurns.byHarness.empty')}</Text>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('codingTurns.byHarness.harness')}</TableHead>
                <TableHead className="text-right">
                  {t('codingTurns.byHarness.turns')}
                </TableHead>
                <TableHead className="text-right">
                  {t('codingTurns.byHarness.successRate')}
                </TableHead>
                <TableHead className="text-right">
                  {t('codingTurns.byHarness.timeouts')}
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
    </MetricsLayout>
  );
}

// Container — owns the metrics query.
export function CodingTurnMetricsPage({
  organizationId,
  periodDays,
  onChangePeriod,
}: CodingTurnMetricsPageProps) {
  const { t } = useT('analytics');

  const { data, isLoading } = useConvexQuery(
    api.sandbox.session_queries_public.getCodingTurnMetrics,
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );

  const handlePeriod = useCallback(
    (value: string) => onChangePeriod(parseMetricsPeriodDays(value)),
    [onChangePeriod],
  );

  return (
    <Skeletonize loading={isLoading} label={t('codingTurns.title')}>
      <CodingTurnMetricsPageView
        data={data ?? undefined}
        periodDays={periodDays}
        onPeriod={handlePeriod}
      />
    </Skeletonize>
  );
}
