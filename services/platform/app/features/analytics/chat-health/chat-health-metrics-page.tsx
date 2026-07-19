'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { ProgressBar } from '@tale/ui/progress-bar';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import type { FunctionReturnType } from 'convex/server';
import { AlertTriangle } from 'lucide-react';
import { useCallback } from 'react';

import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { periodToDays, type ChatHealthPeriod } from './chat-health-period';

export type { ChatHealthPeriod } from './chat-health-period';

type ChatHealthRollup = FunctionReturnType<
  typeof api.message_metadata.queries.getChatHealthRollup
>;

// Sentinels mirrored from `convex/message_metadata/chat_health_stats.ts`. The
// frontend re-declares them (as feedback's UNATTRIBUTED_AGENT_SLUG does) rather
// than importing runtime values across the convex boundary.
const PINNED_ROUTE_REASON = 'pinned';
const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

// autoRouteReason literal → i18n key segment (hyphens aren't valid segments).
const REASON_KEY: Record<string, string> = {
  'single-candidate': 'singleCandidate',
  trivial: 'trivial',
  cached: 'cached',
  classified: 'classified',
  fallback: 'fallback',
  [PINNED_ROUTE_REASON]: 'pinned',
};

interface ChatHealthMetricsPageProps {
  organizationId: string;
  period: ChatHealthPeriod;
  onChangePeriod: (next: ChatHealthPeriod) => void;
}

interface RoutingItem {
  label: string;
  count: number;
  /** Full, untruncated text for the hover tooltip when `label` is clipped.
   *  Defaults to `label` when omitted. */
  title?: string;
}

/**
 * One routing dimension as a ranked share list. Composes the shipped
 * `ProgressBar` (share of turns) — masks to skeleton rows under a surrounding
 * `<Skeletonize>` so the loaded/loading layout matches.
 */
function RoutingBreakdown({
  title,
  items,
  total,
}: {
  title: string;
  items: RoutingItem[];
  total: number;
}) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();
  const loading = useSkeleton();

  return (
    <Stack gap={2}>
      <Text className="text-fg-muted text-sm font-medium">{title}</Text>
      {loading ? (
        <Stack gap={2} aria-hidden>
          {[0, 1, 2].map((i) => (
            <SkeletonBox key={i} fullWidth>
              <div className="h-5 w-full" />
            </SkeletonBox>
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Text variant="caption">—</Text>
      ) : (
        <Stack gap={2}>
          {items.map((item, i) => (
            // Key includes the index because dropping the provider from the
            // model label lets two providers' same-named models collide.
            <HStack
              key={`${item.label}-${i}`}
              align="center"
              justify="between"
              gap={3}
            >
              {/* `title` surfaces the full text on hover so a clipped label
                  (long model/agent name) is still readable. */}
              <Text
                className="min-w-0 flex-1 truncate text-sm"
                title={item.title ?? item.label}
              >
                {item.label}
              </Text>
              {/* ProgressBar shows the share % inline; the exact turn count
                  rides in its tooltip. */}
              <ProgressBar
                value={item.count}
                max={total}
                label={`${item.label}: ${item.count}`}
                tooltipContent={t('chatHealth.routing.turnsTooltip', {
                  count: formatNumber(item.count),
                })}
                className="w-40 shrink-0"
              />
            </HStack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

interface RecentErrorRow {
  key: string;
  time: string;
  typeLabel: string;
  model: string;
  agentSlug: string;
}

/**
 * The most-recent errored turns as a compact time · type · model · agent list.
 * Composes the shared layout/text/badge primitives (mirrors `RoutingBreakdown`)
 * and masks to skeleton rows under a surrounding `<Skeletonize>`.
 */
function RecentErrorsList({ items }: { items: RecentErrorRow[] }) {
  const { t } = useT('analytics');
  const loading = useSkeleton();

  return (
    <Stack gap={2}>
      <Text className="text-fg-muted text-sm font-medium">
        {t('chatHealth.errorBreakdown.recentTitle')}
      </Text>
      {loading ? (
        <Stack gap={2} aria-hidden>
          {[0, 1, 2].map((i) => (
            <SkeletonBox key={i} fullWidth>
              <div className="h-5 w-full" />
            </SkeletonBox>
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Text variant="caption">{t('chatHealth.errorBreakdown.noRecent')}</Text>
      ) : (
        <Stack gap={1}>
          <HStack
            align="center"
            gap={3}
            className="text-fg-muted text-xs font-medium"
          >
            <span className="w-32 shrink-0">
              {t('chatHealth.errorBreakdown.columns.time')}
            </span>
            <span className="w-40 shrink-0">
              {t('chatHealth.errorBreakdown.columns.type')}
            </span>
            <span className="min-w-0 flex-1">
              {t('chatHealth.errorBreakdown.columns.model')}
            </span>
            <span className="w-32 shrink-0 text-right">
              {t('chatHealth.errorBreakdown.columns.agent')}
            </span>
          </HStack>
          {items.map((item) => (
            <HStack key={item.key} align="center" gap={3}>
              <Text className="text-fg-muted w-32 shrink-0 text-xs tabular-nums">
                {item.time}
              </Text>
              <span className="w-40 shrink-0">
                <Badge variant="outline" className="max-w-full">
                  {item.typeLabel}
                </Badge>
              </span>
              <Text
                className="min-w-0 flex-1 truncate text-sm"
                title={item.model}
              >
                {item.model}
              </Text>
              <Text
                className="text-fg-muted w-32 shrink-0 truncate text-right text-sm"
                title={item.agentSlug}
              >
                {item.agentSlug}
              </Text>
            </HStack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

interface ChatHealthMetricsPageViewProps {
  stats: ChatHealthRollup | null;
  period: ChatHealthPeriod;
  isPeriodEmpty: boolean;
  onChangePeriod: (value: string) => void;
}

// Presentational view — no data hooks. Rendered live and, while stats load,
// wrapped in `<Skeletonize>` so loading and loaded layouts share one tree: the
// StatCards mask their values and RoutingBreakdown renders skeleton rows.
export function ChatHealthMetricsPageView({
  stats,
  period,
  isPeriodEmpty,
  onChangePeriod,
}: ChatHealthMetricsPageViewProps) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();
  const { formatDateSmart } = useFormatDate();

  const total = stats?.totalMessages ?? 0;

  const formatPct = (rate: number): string =>
    total === 0
      ? '—'
      : formatNumber(rate, { style: 'percent', maximumFractionDigits: 1 });

  const formatLatency = (ms: number | null): string => {
    if (ms === null) return '—';
    return ms < 1000
      ? t('chatHealth.cards.msValue', { value: formatNumber(ms) })
      : t('chatHealth.cards.secValue', {
          value: formatNumber(ms / 1000, { maximumFractionDigits: 1 }),
        });
  };

  const reasonLabel = (key: string): string => {
    // Every autoRouteReason literal (+ the `pinned` sentinel) is in REASON_KEY;
    // fall back to the raw key for any unmapped value rather than a missing key.
    const segment = REASON_KEY[key];
    return segment ? t(`chatHealth.routing.reasons.${segment}`) : key;
  };

  const agentLabel = (key: string): string =>
    key === UNATTRIBUTED_AGENT_SLUG
      ? t('chatHealth.routing.unattributed')
      : key;

  const reasonItems: RoutingItem[] = (
    stats?.routing.byAutoRouteReason ?? []
  ).map((r) => ({ label: reasonLabel(r.key), count: r.count }));
  const agentItems: RoutingItem[] = (stats?.routing.byAgentSlug ?? []).map(
    (a) => ({ label: agentLabel(a.key), count: a.count }),
  );
  // Lead with the MODEL, not the provider: providers are often identical across
  // rows (e.g. every model on `openrouter`), so a provider-first label truncates
  // to the same useless prefix and hides the only part that differs. The full
  // `provider / model` rides in the hover title.
  const modelItems: RoutingItem[] = (stats?.routing.byModel ?? []).map((m) => ({
    label: m.model,
    title: m.provider ? `${m.provider} / ${m.model}` : m.model,
    count: m.count,
  }));

  // Every classified code has a short `chatHealth.errorType.<code>` label
  // (constant prefix → covered by the i18n usage scanner's wildcard).
  const errorTypeLabel = (code: string): string =>
    t(`chatHealth.errorType.${code}`);

  // Error-type shares read against the error total, so the bars express "what
  // share of failures is this kind" rather than a share of all turns.
  const errorTotal = stats?.errorCount ?? 0;
  const errorTypeItems: RoutingItem[] = (stats?.errors.byType ?? []).map(
    (e) => ({ label: errorTypeLabel(e.key), count: e.count }),
  );
  const recentErrorItems: RecentErrorRow[] = (stats?.errors.recent ?? []).map(
    (e, i) => ({
      key: `${e.at}-${i}`,
      time: formatDateSmart(new Date(e.at)),
      typeLabel: errorTypeLabel(e.type),
      model: e.model ?? '—',
      agentSlug: e.agentSlug ?? '—',
    }),
  );

  return (
    <MetricsLayout
      as="h3"
      title={t('chatHealth.title')}
      description={t('chatHealth.description')}
      toolbar={
        <MetricsPeriodSelect
          periods={['1', '7', '30']}
          value={period}
          onValueChange={onChangePeriod}
        />
      }
      notice={
        <>
          {stats?.capped ? (
            <Alert
              variant="warning"
              icon={AlertTriangle}
              title={t('chatHealth.cappedNotice.title')}
              description={t('chatHealth.cappedNotice.description')}
            />
          ) : null}
          {isPeriodEmpty ? (
            <Alert
              title={t('chatHealth.periodEmpty.title')}
              description={t('chatHealth.periodEmpty.description')}
            />
          ) : null}
        </>
      }
    >
      <StatCardGrid cols={4}>
        <StatCard
          label={t('chatHealth.cards.errorRate')}
          value={formatPct(stats?.errorRate ?? 0)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.errorRateDetail', {
              errors: formatNumber(stats?.errorCount ?? 0),
              total: formatNumber(total),
            })}
          </Text>
        </StatCard>
        <StatCard
          label={t('chatHealth.cards.responseP95')}
          value={formatLatency(stats?.latency.durationMs.p95 ?? null)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.p50Detail', {
              value: formatLatency(stats?.latency.durationMs.p50 ?? null),
            })}
          </Text>
        </StatCard>
        <StatCard
          label={t('chatHealth.cards.firstTokenP95')}
          value={formatLatency(stats?.latency.timeToFirstTokenMs.p95 ?? null)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.p50Detail', {
              value: formatLatency(
                stats?.latency.timeToFirstTokenMs.p50 ?? null,
              ),
            })}
          </Text>
        </StatCard>
        <StatCard
          label={t('chatHealth.cards.messages')}
          value={formatNumber(total)}
        />
      </StatCardGrid>

      <MetricsSection title={t('chatHealth.routing.title')}>
        <Grid md={3} gap={6}>
          <RoutingBreakdown
            title={t('chatHealth.routing.byReason')}
            items={reasonItems}
            total={total}
          />
          <RoutingBreakdown
            title={t('chatHealth.routing.byAgent')}
            items={agentItems}
            total={total}
          />
          <RoutingBreakdown
            title={t('chatHealth.routing.byModel')}
            items={modelItems}
            total={total}
          />
        </Grid>
      </MetricsSection>

      <MetricsSection title={t('chatHealth.errorBreakdown.title')}>
        <Stack gap={6}>
          <RoutingBreakdown
            title={t('chatHealth.errorBreakdown.byType')}
            items={errorTypeItems}
            total={errorTotal}
          />
          <RecentErrorsList items={recentErrorItems} />
        </Stack>
      </MetricsSection>
    </MetricsLayout>
  );
}

// Container — owns the rollup query and the validated period handler. Wraps the
// view in `<Skeletonize>` while stats load. Error / empty-org branches are
// distinct layouts and stay here as early returns (mirrors the feedback page).
export function ChatHealthMetricsPage({
  organizationId,
  period,
  onChangePeriod,
}: ChatHealthMetricsPageProps) {
  const { t } = useT('analytics');

  const {
    data: stats,
    isLoading,
    error,
  } = useConvexQuery(
    api.message_metadata.queries.getChatHealthRollup,
    { organizationId, periodDays: periodToDays(period) },
    { enabled: !!organizationId },
  );

  const handleChangePeriod = useCallback(
    (value: string) => {
      if (value === '1' || value === '7' || value === '30') {
        onChangePeriod(value);
      }
    },
    [onChangePeriod],
  );

  if (error) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('chatHealth.errors.loadFailed')}
        description={error.message}
      />
    );
  }

  // Org has never produced chat telemetry — a teaching panel, not empty KPIs.
  if (!isLoading && stats && !stats.hasAnyData) {
    return (
      <MetricsLayout
        as="h3"
        title={t('chatHealth.title')}
        description={t('chatHealth.description')}
      >
        <Alert
          title={t('chatHealth.empty.title')}
          description={t('chatHealth.empty.description')}
        />
      </MetricsLayout>
    );
  }

  if (!isLoading && !stats) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('chatHealth.errors.unauthorized')}
      />
    );
  }

  const isPeriodEmpty =
    !isLoading && !!stats?.hasAnyData && (stats?.totalMessages ?? 0) === 0;

  return (
    <Skeletonize loading={isLoading} label={t('chatHealth.title')}>
      <ChatHealthMetricsPageView
        stats={stats ?? null}
        period={period}
        isPeriodEmpty={isPeriodEmpty}
        onChangePeriod={handleChangePeriod}
      />
    </Skeletonize>
  );
}
