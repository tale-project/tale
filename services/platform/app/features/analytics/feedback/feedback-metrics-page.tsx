'use client';

import { AlertTriangle } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Alert } from '@/app/components/ui/feedback/alert';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

export type FeedbackPeriod = '1' | '7' | '30' | '90' | 'all';
export type FeedbackKind = 'all' | 'message' | 'arena';

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

  if (statsLoading) {
    return (
      <Stack gap={6} aria-busy="true">
        <Skeleton className="h-10 w-full max-w-2xl rounded-md" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-66 w-full rounded-md" />
        <Skeleton className="h-66 w-full rounded-md" />
      </Stack>
    );
  }

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

  if (!stats) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('feedback.errors.unauthorized')}
      />
    );
  }

  // Org-empty: never collected feedback. Replace cards with a teaching panel.
  if (!stats.hasAnyFeedback) {
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

  const totalMessages = stats.message.total;
  const totalArena = stats.arena.total;
  const isFilteredZero = hasFilters && totalMessages + totalArena === 0;
  const isPeriodEmpty = !hasFilters && totalMessages + totalArena === 0;

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
              onValueChange={handleChangePeriod}
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

      {stats.capped ? (
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
        helpful={stats.message.byRating.positive}
        notHelpful={stats.message.byRating.negative}
        capped={stats.capped}
      />

      <ArenaSummary
        byVerdict={stats.arena.byVerdict}
        total={stats.arena.total}
      />

      {stats.topMatchups.length > 0 ? (
        <TopMatchupsFeedbackTable rows={stats.topMatchups} isLoading={false} />
      ) : null}

      <TopAgentsFeedbackTable
        rows={stats.topAgents}
        isLoading={false}
        onSelectAgent={(slug) => onSelectAgent(slug)}
      />

      <TopModelsFeedbackTable
        rows={stats.topModels}
        isLoading={false}
        onSelectModel={(m, p) => onSelectModel(m, p)}
      />

      <RecentFeedbackTable
        rows={recent.results}
        isLoading={recent.status === 'LoadingFirstPage'}
        hasMore={recent.status === 'CanLoadMore'}
        isLoadingMore={recent.status === 'LoadingMore'}
        onLoadMore={() => recent.loadMore(PAGE_SIZE)}
        headerActions={
          <HStack gap={2} className="flex-wrap">
            <div className="w-36">
              <Select
                options={kindOptions}
                value={kind}
                onValueChange={handleChangeKind}
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
