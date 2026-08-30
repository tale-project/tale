'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { HStack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import {
  MetricsFilterChips,
  type MetricsFilterChip,
} from '@/app/components/metrics/metrics-filter-chips';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { ArenaSummary } from './arena-summary';
import { periodToDays, type FeedbackPeriod } from './feedback-period';
import { FeedbackSummaryCards } from './feedback-summary-cards';
import { RecentFeedbackTable } from './recent-feedback-table';
import { TopAgentsFeedbackTable } from './top-agents-feedback-table';
import { TopMatchupsFeedbackTable } from './top-matchups-feedback-table';
import { TopModelsFeedbackTable } from './top-models-feedback-table';
import type { RecentFeedbackItem } from './types';

export type { FeedbackPeriod } from './feedback-period';
export type FeedbackKind = 'all' | 'message' | 'arena';

type FeedbackStats = ReturnsOf<'feedback/queries:getFeedbackStats'>;

interface FeedbackMetricsPageProps {
  organizationId: string;
  period: FeedbackPeriod;
  kind: FeedbackKind;
  withCommentOnly: boolean;
  agentSlug?: string;
  model?: string;
  provider?: string;
  onChangePeriod: (next: FeedbackPeriod) => void;
  onChangeKind: (next: FeedbackKind) => void;
  onToggleCommentOnly: (next: boolean) => void;
  onSelectAgent: (slug: string | null) => void;
  onSelectModel: (model: string | null, provider: string | null) => void;
  onClearFilters: () => void;
}

const PAGE_SIZE = 25;

interface FeedbackMetricsPageViewProps {
  /** Resolved stats; `null` while loading (the enclosing `<Skeletonize>` masks
   *  the cards/arena/tables, which stand in at full height). */
  stats: FeedbackStats | null;
  loading: boolean;
  period: FeedbackPeriod;
  kind: FeedbackKind;
  withCommentOnly: boolean;
  agentSlug?: string;
  model?: string;
  provider?: string;
  recentRows: RecentFeedbackItem[];
  recentLoading: boolean;
  recentHasMore: boolean;
  recentLoadingMore: boolean;
  onLoadMoreRecent: () => void;
  /** Loaded-and-empty for the active period with no filters. */
  isPeriodEmpty: boolean;
  /** Loaded-and-empty with filters applied. */
  isFilteredZero: boolean;
  onChangePeriod: (v: string) => void;
  onChangeKind: (v: string) => void;
  onToggleCommentOnly: (next: boolean) => void;
  onSelectAgent: (slug: string | null) => void;
  onSelectModel: (model: string | null, provider: string | null) => void;
  onClearFilters: () => void;
}

// =============================================================================
// Plain presentational view — no data hooks. Rendered live (by the container)
// and, while stats load, wrapped in `<Skeletonize>` so the loading and loaded
// layouts are the SAME tree. Skeleton-aware leaves (Select, Switch) auto-mask;
// the summary cards + arena summary mask their values; the top-N + recent
// DataTables render skeleton rows from their `isLoading` flags. The empty/
// filter alerts stay in the container (they describe a loaded, not loading,
// state).
// =============================================================================
export function FeedbackMetricsPageView({
  stats,
  loading,
  period,
  kind,
  withCommentOnly,
  agentSlug,
  model,
  provider,
  recentRows,
  recentLoading,
  recentHasMore,
  recentLoadingMore,
  onLoadMoreRecent,
  isPeriodEmpty,
  isFilteredZero,
  onChangePeriod,
  onChangeKind,
  onToggleCommentOnly,
  onSelectAgent,
  onSelectModel,
  onClearFilters,
}: FeedbackMetricsPageViewProps) {
  const { t } = useT('analytics');

  const kindOptions = useMemo(
    () => [
      { value: 'all', label: t('feedback.kind.all') },
      { value: 'message', label: t('feedback.kind.message') },
      { value: 'arena', label: t('feedback.kind.arena') },
    ],
    [t],
  );

  // While loading these are all 0/empty; the masked cards/arena/tables fill the
  // structure so nothing pops in when the real numbers arrive.
  const showMatchups = loading || (stats?.topMatchups.length ?? 0) > 0;

  const sentimentSeries: ChartSeries[] = [
    {
      key: 'positive',
      label: t('feedback.cards.helpful'),
      color: CHART_COLORS.success,
      stackId: 'sentiment',
    },
    {
      key: 'negative',
      label: t('feedback.cards.notHelpful'),
      color: CHART_COLORS.failure,
      stackId: 'sentiment',
    },
  ];
  const showSentimentTrend = loading || (stats?.series?.length ?? 0) > 0;

  const filterChips: MetricsFilterChip[] = [];
  if (agentSlug)
    filterChips.push({
      key: 'agent',
      label: t('feedback.filterChips.agent', { value: agentSlug }),
      onClear: () => onSelectAgent(null),
    });
  if (model)
    filterChips.push({
      key: 'model',
      label: t('feedback.filterChips.model', { value: model }),
      onClear: () => onSelectModel(null, null),
    });
  else if (provider)
    filterChips.push({
      key: 'provider',
      label: t('feedback.filterChips.provider', { value: provider }),
      onClear: () => onSelectModel(null, null),
    });

  return (
    <MetricsLayout
      as="h3"
      title={t('feedback.title')}
      description={t('feedback.description')}
      toolbar={
        <MetricsPeriodSelect
          periods={['1', '7', '30', '90', 'all']}
          value={period}
          onValueChange={onChangePeriod}
        />
      }
      filters={
        <MetricsFilterChips
          chips={filterChips}
          onClearAll={onClearFilters}
          clearAllLabel={t('feedback.filterChips.clear')}
        />
      }
      notice={
        // These notices describe a LOADED result (capped sample, empty
        // period/filter) — they render only once stats arrive.
        <>
          {stats?.capped ? (
            <Alert
              variant="warning"
              icon={AlertTriangle}
              title={t('feedback.cappedNotice.title')}
              description={t('feedback.cappedNotice.description')}
            />
          ) : null}
          {isPeriodEmpty ? (
            <Alert
              title={t('feedback.periodEmpty.title')}
              description={
                <span>
                  {t('feedback.periodEmpty.description')}{' '}
                  <Button variant="link" onClick={() => onChangePeriod('all')}>
                    {t('feedback.periodEmpty.expand')}
                  </Button>
                </span>
              }
            />
          ) : null}
          {isFilteredZero ? (
            <Alert
              title={t('feedback.filterEmpty.title')}
              description={
                <span>
                  {t('feedback.filterEmpty.description')}{' '}
                  <Button variant="link" onClick={onClearFilters}>
                    {t('feedback.filterEmpty.clear')}
                  </Button>
                </span>
              }
            />
          ) : null}
        </>
      }
    >
      <FeedbackSummaryCards
        helpful={stats?.message.byRating.positive ?? 0}
        notHelpful={stats?.message.byRating.negative ?? 0}
        capped={stats?.capped ?? false}
        previous={stats?.previous}
      />

      <ArenaSummary
        byVerdict={
          stats?.arena.byVerdict ?? {
            a_better: 0,
            b_better: 0,
            tie: 0,
            both_bad: 0,
          }
        }
        total={stats?.arena.total ?? 0}
      />

      {showSentimentTrend ? (
        <ChartCard
          title={t('feedback.sentimentTrend')}
          loading={loading}
          bodyClassName="h-52"
          legend={<ChartLegend items={seriesToLegend(sentimentSeries)} />}
        >
          <TrendBarChart
            data={stats?.series ?? []}
            series={sentimentSeries}
            xKey="dateKey"
            xTickFormatter={(key) => key.slice(5)}
          />
        </ChartCard>
      ) : null}

      {showMatchups ? (
        <TopMatchupsFeedbackTable
          rows={stats?.topMatchups ?? []}
          isLoading={loading}
        />
      ) : null}

      <TopAgentsFeedbackTable
        rows={stats?.topAgents ?? []}
        isLoading={loading}
        onSelectAgent={(slug) => onSelectAgent(slug)}
      />

      <TopModelsFeedbackTable
        rows={stats?.topModels ?? []}
        isLoading={loading}
        onSelectModel={(m, p) => onSelectModel(m, p)}
      />

      <RecentFeedbackTable
        rows={recentRows}
        isLoading={recentLoading}
        hasMore={recentHasMore}
        isLoadingMore={recentLoadingMore}
        onLoadMore={onLoadMoreRecent}
        headerActions={
          <HStack gap={2} className="flex-wrap">
            <div className="w-36">
              <Select
                options={kindOptions}
                value={kind}
                onValueChange={onChangeKind}
                aria-label={t('feedback.kind.label')}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={withCommentOnly}
                onCheckedChange={onToggleCommentOnly}
                aria-label={t('feedback.commentsOnly')}
              />
              <span>{t('feedback.commentsOnly')}</span>
            </label>
          </HStack>
        }
      />
    </MetricsLayout>
  );
}

// =============================================================================
// Container — owns the stats + recent-feedback queries and the validated
// search-param handlers. Wraps the plain view in `<Skeletonize>` while stats
// load (no separate skeleton file). The error/empty-org branches are distinct
// layouts and stay here as early returns.
// =============================================================================
export function FeedbackMetricsPage({
  organizationId,
  period,
  kind,
  withCommentOnly,
  agentSlug,
  model,
  provider,
  onChangePeriod,
  onChangeKind,
  onToggleCommentOnly,
  onSelectAgent,
  onSelectModel,
  onClearFilters,
}: FeedbackMetricsPageProps) {
  const { t } = useT('analytics');

  const periodDays = periodToDays(period);

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useConvexQuery(
    'feedback/queries:getFeedbackStats',
    {
      organizationId,
      periodDays,
      agentSlug,
      model,
      provider,
    },
    { enabled: !!organizationId },
  );

  const recent = useCachedPaginatedQuery(
    'feedback/queries:listRecentFeedback',
    {
      organizationId,
      periodDays,
      kind,
      withCommentOnly,
      agentSlug,
      model,
      provider,
    },
    { initialNumItems: PAGE_SIZE },
  );

  const handleChangePeriod = useCallback(
    (v: string) => {
      if (v === '1' || v === '7' || v === '30' || v === '90' || v === 'all') {
        onChangePeriod(v);
      }
    },
    [onChangePeriod],
  );
  const handleChangeKind = useCallback(
    (v: string) => {
      if (v === 'all' || v === 'message' || v === 'arena') {
        onChangeKind(v);
      }
    },
    [onChangeKind],
  );

  const hasFilters = !!(agentSlug || model || provider);

  if (statsError) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('feedback.errors.loadFailed')}
        description={statsError.message}
      />
    );
  }

  // Org-empty: never collected feedback. Replace cards with a teaching panel.
  // Only knowable once stats resolve (during load we render the skeleton).
  if (!statsLoading && stats && !stats.hasAnyFeedback) {
    return (
      <MetricsLayout
        as="h3"
        title={t('feedback.title')}
        description={t('feedback.description')}
      >
        <Alert
          title={t('feedback.empty.title')}
          description={t('feedback.empty.description')}
        />
      </MetricsLayout>
    );
  }

  if (!statsLoading && !stats) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('feedback.errors.unauthorized')}
      />
    );
  }

  const totalMessages = stats?.message.total ?? 0;
  const totalArena = stats?.arena.total ?? 0;
  const isFilteredZero =
    !statsLoading && hasFilters && totalMessages + totalArena === 0;
  const isPeriodEmpty =
    !statsLoading && !hasFilters && totalMessages + totalArena === 0;

  return (
    <Skeletonize loading={statsLoading} label={t('feedback.title')}>
      <FeedbackMetricsPageView
        stats={stats ?? null}
        loading={statsLoading}
        period={period}
        kind={kind}
        withCommentOnly={withCommentOnly}
        agentSlug={agentSlug}
        model={model}
        provider={provider}
        recentRows={recent.results}
        recentLoading={recent.status === 'LoadingFirstPage'}
        recentHasMore={recent.status === 'CanLoadMore'}
        recentLoadingMore={recent.status === 'LoadingMore'}
        onLoadMoreRecent={() => recent.loadMore(PAGE_SIZE)}
        isPeriodEmpty={isPeriodEmpty}
        isFilteredZero={isFilteredZero}
        onChangePeriod={handleChangePeriod}
        onChangeKind={handleChangeKind}
        onToggleCommentOnly={onToggleCommentOnly}
        onSelectAgent={onSelectAgent}
        onSelectModel={onSelectModel}
        onClearFilters={onClearFilters}
      />
    </Skeletonize>
  );
}
