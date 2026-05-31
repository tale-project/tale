'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { ArenaSummary } from './arena-summary';
import { FeedbackSummaryCards } from './feedback-summary-cards';
import { FilterChips } from './filter-chips';
import { RecentFeedbackTable } from './recent-feedback-table';
import { TopAgentsFeedbackTable } from './top-agents-feedback-table';
import { TopMatchupsFeedbackTable } from './top-matchups-feedback-table';
import { TopModelsFeedbackTable } from './top-models-feedback-table';
import type { RecentFeedbackItem } from './types';

export type FeedbackPeriod = '1' | '7' | '30' | '90' | 'all';
export type FeedbackKind = 'all' | 'message' | 'arena';

type FeedbackStats = FunctionReturnType<
  typeof api.feedback.queries.getFeedbackStats
>;

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

function periodToDays(p: FeedbackPeriod): 1 | 7 | 30 | 90 | undefined {
  if (p === 'all') return undefined;
  if (p === '1') return 1;
  if (p === '7') return 7;
  if (p === '30') return 30;
  return 90;
}

interface FeedbackMetricsPageViewProps {
  organizationId: string;
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
  organizationId,
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

  const periodOptions = useMemo(
    () => [
      { value: '1', label: t('feedback.period.last24Hours') },
      { value: '7', label: t('feedback.period.last7Days') },
      { value: '30', label: t('feedback.period.last30Days') },
      { value: '90', label: t('feedback.period.last90Days') },
      { value: 'all', label: t('feedback.period.allTime') },
    ],
    [t],
  );

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

  return (
    <Stack gap={6}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <Header
          title={t('feedback.title')}
          description={t('feedback.description')}
        />
        <HStack gap={2} className="flex-wrap">
          <div className="w-36">
            <Select
              options={periodOptions}
              value={period}
              onValueChange={onChangePeriod}
              size="sm"
              aria-label={t('feedback.period.label')}
            />
          </div>
        </HStack>
      </div>

      <FilterChips
        agentSlug={agentSlug}
        model={model}
        provider={provider}
        onClearAgent={() => onSelectAgent(null)}
        onClearModel={() => onSelectModel(null, null)}
        onClearAll={onClearFilters}
      />

      {/* These notices describe a LOADED result (capped sample, empty
          period/filter). They render only once stats arrive — never during
          the skeleton — so they slot in at their natural position without
          masking. */}
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
              <Button
                variant="link"
                size="sm"
                onClick={() => onChangePeriod('all')}
              >
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
              <Button variant="link" size="sm" onClick={onClearFilters}>
                {t('feedback.filterEmpty.clear')}
              </Button>
            </span>
          }
        />
      ) : null}

      <FeedbackSummaryCards
        helpful={stats?.message.byRating.positive ?? 0}
        notHelpful={stats?.message.byRating.negative ?? 0}
        capped={stats?.capped ?? false}
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
        organizationId={organizationId}
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
                size="sm"
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
    </Stack>
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
  } = useConvexQuery(api.feedback.queries.getFeedbackStats, {
    organizationId,
    periodDays,
    agentSlug,
    model,
    provider,
  });

  const recent = useCachedPaginatedQuery(
    api.feedback.queries.listRecentFeedback,
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
      <Stack gap={6}>
        <Header
          title={t('feedback.title')}
          description={t('feedback.description')}
        />
        <Alert
          title={t('feedback.empty.title')}
          description={t('feedback.empty.description')}
        />
      </Stack>
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
        organizationId={organizationId}
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

function Header({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {title}
      </Text>
      <Text variant="caption">{description}</Text>
    </div>
  );
}
