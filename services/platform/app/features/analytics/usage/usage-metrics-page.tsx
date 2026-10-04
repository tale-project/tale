'use client';

import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import {
  MetricsFilterChips,
  type MetricsFilterChip,
} from '@tale/ui/metrics/metrics-filter-chips';
import { MetricsLayout } from '@tale/ui/metrics/metrics-layout';
import {
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@tale/ui/metrics/metrics-period';
import { MetricsPeriodSelect } from '@tale/ui/metrics/metrics-period-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { readStateOf } from '@/app/lib/backend/read-state';
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
  granularity?: UsageGranularity;
  metric?: UsageMetric;
  onChangeGranularity?: (granularity: UsageGranularity) => void;
  onChangeMetric?: (metric: UsageMetric) => void;
  onChangePeriod?: (period: MetricsPeriodDays) => void;
}

type UsageMetricsData =
  | ReturnsOf<'governance/queries:getOrgUsageMetrics'>
  | undefined;

interface UsageMetricsPageViewProps {
  /** Resolved metrics payload; `undefined` while loading (masked by the
   *  enclosing `<Skeletonize>` — cards/chart/tables stand in at full height). */
  data: UsageMetricsData;
  isLoading: boolean;
  /** The failed read's notice, above whatever the page still shows. */
  readFailure?: ReactNode;
  /** The read never answered: no figure is known, so the cards, chart and
   *  tables give way to `readFailure` — a zero there would claim measured
   *  usage the server never reported (#3641). */
  unavailable?: boolean;
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
function UsageMetricsPageView({
  data,
  isLoading,
  readFailure,
  unavailable = false,
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
        <MetricsPeriodSelect
          value={String(periodDays)}
          onValueChange={onPeriod}
          extraFilters={[
            {
              key: 'granularity',
              title: t('usage.granularity.label'),
              options: granularityOptions,
              selectedValues: [granularity],
              defaultValues: ['daily'],
              onChange: (values) => onGranularity(values[0] ?? 'daily'),
            },
            {
              key: 'metric',
              title: t('usage.metric.label'),
              options: metricOptions,
              selectedValues: [metric],
              defaultValues: ['tokens'],
              onChange: (values) => onMetric(values[0] ?? 'tokens'),
            },
          ]}
        />
      }
      filters={
        <MetricsFilterChips
          chips={filterChips}
          onClearAll={onClearAll}
          clearAllLabel={t('usage.filterChips.clear')}
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
                title={t('usage.cappedNotice')}
              />
            ) : null}
          </>
        ) : undefined
      }
    >
      {unavailable ? null : (
        <>
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
        </>
      )}
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
  granularity: granularityProp,
  metric: metricProp,
  onChangeGranularity,
  onChangeMetric,
}: UsageMetricsPageProps) {
  const { t } = useT('analytics');

  const [internalPeriodDays, setInternalPeriodDays] =
    useState<MetricsPeriodDays>(30);
  const periodDays = periodDaysProp ?? internalPeriodDays;
  const [internalGranularity, setGranularity] =
    useState<UsageGranularity>('daily');
  const [internalMetric, setMetric] = useState<UsageMetric>('tokens');
  const granularity = granularityProp ?? internalGranularity;
  const metric = metricProp ?? internalMetric;
  const [agentSlug, setAgentSlug] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [provider, setProvider] = useState<string | undefined>(undefined);

  const usage = useBackendQuery(
    'governance/queries:getOrgUsageMetrics',
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
  const { data, isLoading, refetch } = usage;
  // A failed read is named, never passed off as zero usage (#3641): the
  // flags hold through a retry, which react-query starts from `pending`.
  const read = readStateOf(usage);
  // Where a Try again that worked hands its focus as the notice goes: the
  // page's region, around the figures it brought back.
  const regionRef = useRef<HTMLDivElement>(null);
  const focusRegion = useCallback(() => regionRef.current?.focus(), []);
  const retry = useCallback(() => void refetch(), [refetch]);
  const failureMessage = [
    t(read.stale ? 'usage.errors.refreshFailed' : 'usage.errors.loadFailed'),
    failureDetail(usage.error),
  ]
    .filter(Boolean)
    .join(' ');

  const handlePeriod = useCallback(
    (v: string) => {
      const next = parseMetricsPeriodDays(v);
      if (onChangePeriod) onChangePeriod(next);
      else setInternalPeriodDays(next);
    },
    [onChangePeriod],
  );
  const handleGranularity = useCallback(
    (v: string) => {
      if (v === 'daily' || v === 'weekly' || v === 'monthly') {
        if (onChangeGranularity) onChangeGranularity(v);
        else setGranularity(v);
      }
    },
    [onChangeGranularity],
  );
  const handleMetric = useCallback(
    (v: string) => {
      if (v === 'requests' || v === 'tokens' || v === 'cost') {
        if (onChangeMetric) onChangeMetric(v);
        else setMetric(v);
      }
    },
    [onChangeMetric],
  );

  const clearAll = useCallback(() => {
    setAgentSlug(undefined);
    setModel(undefined);
    setProvider(undefined);
  }, []);

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={t('usage.title')}
      tabIndex={-1}
      className="outline-none"
    >
      {/* A failed read that is being retried stays named, with its Try
          again busy, rather than turning back into the skeleton. */}
      <Skeletonize
        loading={isLoading && !read.unavailable}
        label={t('usage.title')}
      >
        <UsageMetricsPageView
          data={data}
          isLoading={isLoading}
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
    </div>
  );
}
