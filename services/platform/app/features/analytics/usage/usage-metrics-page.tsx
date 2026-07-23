'use client';

import { Alert } from '@tale/ui/alert';
import { Skeletonize } from '@tale/ui/skeleton-context';
import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { MetricSelect } from '@/app/components/metrics/metric-select';
import {
  MetricsFilterChips,
  type MetricsFilterChip,
} from '@/app/components/metrics/metrics-filter-chips';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { TopAgentsTable } from './top-agents-table';
import { TopModelsTable } from './top-models-table';
import { TopVoiceModelsTable } from './top-voice-models-table';
import { UsageSummaryCards } from './usage-summary-cards';
import {
  UsageTrendChart,
  type UsageGranularity,
  type UsageMetric,
} from './usage-trend-chart';
import { UsersTable } from './users-table';

export interface UsageMetricsPageProps {
  organizationId: string;
  /** Controlled period (e.g. from the route's `?period=`); when provided with
   *  `onChangePeriod`, the page defers period state to the caller. */
  periodDays?: MetricsPeriodDays;
  onChangePeriod?: (period: MetricsPeriodDays) => void;
}

type UsageMetricsData =
  | FunctionReturnType<typeof api.governance.queries.getOrgUsageMetrics>
  | undefined;

interface UsageMetricsPageViewProps {
  /** Resolved metrics payload; `undefined` while loading (masked by the
   *  enclosing `<Skeletonize>` — cards/chart/tables stand in at full height). */
  data: UsageMetricsData;
  isLoading: boolean;
  periodDays: MetricsPeriodDays;
  granularity: UsageGranularity;
  metric: UsageMetric;
  agentSlug: string | undefined;
  model: string | undefined;
  provider: string | undefined;
  onPeriod: (v: string) => void;
  onGranularity: (v: string) => void;
  onMetric: (v: string) => void;
  onSelectAgent: (slug: string | undefined) => void;
  onSelectModel: (model: string | undefined) => void;
  onSelectProvider: (provider: string | undefined) => void;
  onClearAll: () => void;
}

// =============================================================================
// Plain presentational view — no data hooks. Rendered both live (by the
// container) and as its own skeleton (wrapped in `<Skeletonize>`), so the
// loading and loaded layouts are the SAME tree and cannot drift. The
// skeleton-aware leaves (Select, Badge, Button) auto-mask; the summary cards
// mask their numeric values; the chart reserves its `h-72` plot; the four
// DataTables render skeleton rows from `isLoading`.
// =============================================================================
export function UsageMetricsPageView({
  data,
  isLoading,
  periodDays,
  granularity,
  metric,
  agentSlug,
  model,
  provider,
  onPeriod,
  onGranularity,
  onMetric,
  onSelectAgent,
  onSelectModel,
  onSelectProvider,
  onClearAll,
}: UsageMetricsPageViewProps) {
  const { t } = useT('analytics');

  const granularityOptions = useMemo(
    () => [
      { value: 'daily', label: t('usage.granularity.daily') },
      { value: 'weekly', label: t('usage.granularity.weekly') },
      { value: 'monthly', label: t('usage.granularity.monthly') },
    ],
    [t],
  );
  const metricOptions = useMemo(
    () => [
      { value: 'tokens', label: t('usage.metric.tokens') },
      { value: 'requests', label: t('usage.metric.requests') },
      { value: 'cost', label: t('usage.metric.cost') },
    ],
    [t],
  );

  const summary = data?.summary;
  const series = data?.series ?? [];
  const topAgents = data?.topAgents ?? [];
  const topModels = data?.topModels ?? [];
  const topVoiceModels = data?.topVoiceModels ?? [];
  const users = data?.users ?? [];

  const filterChips: MetricsFilterChip[] = [];
  if (agentSlug !== undefined)
    filterChips.push({
      key: 'agent',
      label: t('usage.filterChips.agent', { value: agentSlug }),
      onClear: () => onSelectAgent(undefined),
    });
  if (model !== undefined)
    filterChips.push({
      key: 'model',
      label: t('usage.filterChips.model', { value: model }),
      onClear: () => onSelectModel(undefined),
    });
  if (provider !== undefined)
    filterChips.push({
      key: 'provider',
      label: t('usage.filterChips.provider', { value: provider }),
      onClear: () => onSelectProvider(undefined),
    });

  return (
    <MetricsLayout
      as="h3"
      title={t('usage.title')}
      description={t('usage.description')}
      toolbar={
        <>
          <MetricsPeriodSelect
            value={String(periodDays)}
            onValueChange={onPeriod}
          />
          <MetricSelect
            aria-label={t('usage.granularity.label')}
            options={granularityOptions}
            value={granularity}
            onValueChange={onGranularity}
          />
          <MetricSelect
            aria-label={t('usage.metric.label')}
            options={metricOptions}
            value={metric}
            onValueChange={onMetric}
          />
        </>
      }
      filters={
        <MetricsFilterChips
          chips={filterChips}
          onClearAll={onClearAll}
          clearAllLabel={t('usage.filterChips.clear')}
        />
      }
      notice={
        summary?.capped ? (
          <Alert
            variant="warning"
            icon={AlertTriangle}
            title={t('usage.cappedNotice')}
          />
        ) : undefined
      }
    >
      <UsageSummaryCards
        totalRequests={summary?.totalRequests ?? 0}
        totalTokens={summary?.totalTokens ?? 0}
        totalCostCents={summary?.totalCostCents ?? 0}
        activeUsers={summary?.activeUsers ?? 0}
        previous={data?.previousSummary}
      />

      <UsageTrendChart
        series={series}
        metric={metric}
        granularity={granularity}
      />

      <TopAgentsTable
        rows={topAgents}
        isLoading={isLoading}
        onSelectAgent={onSelectAgent}
      />

      <TopModelsTable
        rows={topModels}
        isLoading={isLoading}
        onSelectModel={onSelectModel}
      />

      <TopVoiceModelsTable
        rows={topVoiceModels}
        isLoading={isLoading}
        onSelectModel={onSelectModel}
      />

      <UsersTable rows={users} isLoading={isLoading} />
    </MetricsLayout>
  );
}

// =============================================================================
// Container — owns the filter/period state and the metrics query. Wraps the
// plain view in `<Skeletonize>` so the same tree renders the skeleton while
// the metrics load (no separate skeleton file to drift from the real layout).
// =============================================================================
export function UsageMetricsPage({
  organizationId,
  periodDays: periodDaysProp,
  onChangePeriod,
}: UsageMetricsPageProps) {
  const { t } = useT('analytics');

  const [internalPeriodDays, setInternalPeriodDays] =
    useState<MetricsPeriodDays>(30);
  const periodDays = periodDaysProp ?? internalPeriodDays;
  const [granularity, setGranularity] = useState<UsageGranularity>('daily');
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [agentSlug, setAgentSlug] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [provider, setProvider] = useState<string | undefined>(undefined);

  const { data, isLoading } = useConvexQuery(
    api.governance.queries.getOrgUsageMetrics,
    {
      organizationId,
      periodDays,
      granularity,
      agentSlug,
      model,
      provider,
    },
    { enabled: !!organizationId },
  );

  const handlePeriod = useCallback(
    (v: string) => {
      const next = parseMetricsPeriodDays(v);
      if (onChangePeriod) onChangePeriod(next);
      else setInternalPeriodDays(next);
    },
    [onChangePeriod],
  );
  const handleGranularity = useCallback((v: string) => {
    if (v === 'daily' || v === 'weekly' || v === 'monthly') {
      setGranularity(v);
    }
  }, []);
  const handleMetric = useCallback((v: string) => {
    if (v === 'requests' || v === 'tokens' || v === 'cost') {
      setMetric(v);
    }
  }, []);

  const clearAll = useCallback(() => {
    setAgentSlug(undefined);
    setModel(undefined);
    setProvider(undefined);
  }, []);

  return (
    <Skeletonize loading={isLoading} label={t('usage.title')}>
      <UsageMetricsPageView
        data={data}
        isLoading={isLoading}
        periodDays={periodDays}
        granularity={granularity}
        metric={metric}
        agentSlug={agentSlug}
        model={model}
        provider={provider}
        onPeriod={handlePeriod}
        onGranularity={handleGranularity}
        onMetric={handleMetric}
        onSelectAgent={setAgentSlug}
        onSelectModel={setModel}
        onSelectProvider={setProvider}
        onClearAll={clearAll}
      />
    </Skeletonize>
  );
}
