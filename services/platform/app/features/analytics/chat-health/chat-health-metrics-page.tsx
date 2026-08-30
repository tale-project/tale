'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { ChartCard } from '@tale/ui/chart-card';
import { ChartLegend } from '@tale/ui/chart-legend';
import { CHART_COLORS } from '@tale/ui/chart-theme';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { ProgressBar } from '@tale/ui/progress-bar';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { AlertTriangle } from 'lucide-react';
import { useCallback } from 'react';

import {
  seriesToLegend,
  TrendBarChart,
  type ChartSeries,
} from '@/app/components/metrics/charts';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { type ChatHealthPeriod, periodToDays } from './chat-health-period';

export type { ChatHealthPeriod } from './chat-health-period';

type ChatHealthData = ReturnsOf<'chat/messages:getOrgChatHealth'>;
type GuardrailStats = ReturnsOf<'chat_filter_events/queries:getGuardrailStats'>;

// Sentinel mirrored from `convex/chat/messages.ts:getOrgChatHealth` — the
// frontend re-declares it rather than importing a runtime value across the
// convex boundary.
const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

// chatFilterEvents `kind` / `filterName` literals → the guardrails-overview
// label keys (in the `governance` namespace) so both surfaces name them alike.
const KIND_LABEL_KEY: Record<string, string> = {
  detected: 'guardrailsOverview.recentEvents.kindDetected',
  blocked: 'guardrailsOverview.recentEvents.kindBlocked',
  step_error: 'guardrailsOverview.recentEvents.kindStepError',
  circuit_open: 'guardrailsOverview.recentEvents.kindCircuitOpen',
};
const FILTER_LABEL_KEY: Record<string, string> = {
  pii: 'guardrailsOverview.filterNames.pii',
  chat_filter: 'guardrailsOverview.filterNames.chatFilter',
  moderation_provider: 'guardrailsOverview.filterNames.moderation',
};

interface ChatHealthMetricsPageProps {
  organizationId: string;
  period: ChatHealthPeriod;
  onChangePeriod: (next: ChatHealthPeriod) => void;
}

interface BreakdownItem {
  label: string;
  count: number;
  /** Full, untruncated text for the hover tooltip when `label` is clipped.
   *  Defaults to `label` when omitted. */
  title?: string;
}

/**
 * One dimension as a ranked share list. Composes the shipped `ProgressBar`
 * (share of `total`) — masks to skeleton rows under a surrounding
 * `<Skeletonize>` so the loaded/loading layout matches.
 */
function BreakdownList({
  title,
  items,
  total,
  countTooltip,
}: {
  title: string;
  items: BreakdownItem[];
  total: number;
  /** Tooltip for one bar, from its count (already-translated ICU string). */
  countTooltip: (count: number) => string;
}) {
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
              {/* ProgressBar shows the share % inline; the exact count rides
                  in its tooltip. */}
              <ProgressBar
                value={item.count}
                max={total}
                label={`${item.label}: ${item.count}`}
                tooltipContent={countTooltip(item.count)}
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
 * Composes the shared layout/text/badge primitives (mirrors `BreakdownList`)
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

/** Short axis label `06-13` from a `2026-06-13` date key (tooltip keeps full). */
function shortLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${month}-${day}`;
}

/** Turns per day, split by outcome (successful / errored / blocked). */
function TurnTrendChart({ series }: { series: ChatHealthData['series'] }) {
  const { t } = useT('analytics');

  const chartSeries: ChartSeries[] = [
    {
      key: 'ok',
      label: t('chatHealth.chart.ok'),
      color: CHART_COLORS.success,
      stackId: 'turns',
    },
    {
      key: 'errors',
      label: t('chatHealth.chart.errors'),
      color: CHART_COLORS.failure,
      stackId: 'turns',
    },
    {
      key: 'blocked',
      label: t('chatHealth.chart.blocked'),
      color: CHART_COLORS.warning,
      stackId: 'turns',
    },
  ];

  // Errored and blocked turns are subsets of `turns`; the remainder is the
  // healthy band so the stack's height stays the day's turn total.
  const rows = series.map((point) => ({
    dateKey: point.dateKey,
    ok: Math.max(0, point.turns - point.errors - point.blocked),
    errors: point.errors,
    blocked: point.blocked,
  }));
  const isEmpty = series.every((point) => point.turns === 0);

  return (
    <ChartCard
      title={t('chatHealth.chart.trendTitle')}
      tooltip={t('chatHealth.chart.trendTooltip')}
      isEmpty={isEmpty}
      emptyTitle={t('chatHealth.chart.noData')}
      emptyDescription={t('chatHealth.chart.noDataDescription')}
      legend={<ChartLegend items={seriesToLegend(chartSeries)} />}
    >
      <TrendBarChart
        data={rows}
        series={chartSeries}
        xKey="dateKey"
        xTickFormatter={shortLabel}
      />
    </ChartCard>
  );
}

/** Guardrail events per day (detections / blocks / filter errors). */
function GuardrailTrendChart({ series }: { series: GuardrailStats['series'] }) {
  const { t } = useT('analytics');

  const chartSeries: ChartSeries[] = [
    {
      key: 'detected',
      label: t('chatHealth.guardrails.chart.detected'),
      color: CHART_COLORS.primary,
      stackId: 'events',
    },
    {
      key: 'blocked',
      label: t('chatHealth.guardrails.chart.blocked'),
      color: CHART_COLORS.warning,
      stackId: 'events',
    },
    {
      key: 'errors',
      label: t('chatHealth.guardrails.chart.errors'),
      color: CHART_COLORS.failure,
      stackId: 'events',
    },
  ];

  const isEmpty = series.every(
    (point) => !point.detected && !point.blocked && !point.errors,
  );

  return (
    <ChartCard
      title={t('chatHealth.guardrails.chart.title')}
      tooltip={t('chatHealth.guardrails.chart.tooltip')}
      bodyClassName="h-48"
      isEmpty={isEmpty}
      emptyTitle={t('chatHealth.guardrails.chart.noData')}
      emptyDescription={t('chatHealth.guardrails.chart.noDataDescription')}
      legend={<ChartLegend items={seriesToLegend(chartSeries)} />}
    >
      <TrendBarChart
        data={series}
        series={chartSeries}
        xKey="dateKey"
        xTickFormatter={shortLabel}
      />
    </ChartCard>
  );
}

interface ChatHealthMetricsPageViewProps {
  health: ChatHealthData | null;
  guardrails: GuardrailStats | null;
  period: ChatHealthPeriod;
  isPeriodEmpty: boolean;
  onChangePeriod: (value: string) => void;
}

// Presentational view — no data hooks. Rendered live and, while stats load,
// wrapped in `<Skeletonize>` so loading and loaded layouts share one tree: the
// StatCards mask their values and the breakdown lists render skeleton rows.
export function ChatHealthMetricsPageView({
  health,
  guardrails,
  period,
  isPeriodEmpty,
  onChangePeriod,
}: ChatHealthMetricsPageViewProps) {
  const { t } = useT('analytics');
  const { t: tGov } = useT('governance');
  const { formatNumber } = useFormatNumber();
  const { formatDateSmart } = useFormatDate();

  const summary = health?.summary;
  const totalTurns = summary?.totalTurns ?? 0;

  const formatPct = (rate: number): string =>
    totalTurns === 0
      ? '—'
      : formatNumber(rate, { style: 'percent', maximumFractionDigits: 1 });

  const agentLabel = (key: string): string =>
    key === UNATTRIBUTED_AGENT_SLUG
      ? t('chatHealth.routing.unattributed')
      : key;

  const agentItems: BreakdownItem[] = (health?.byAgent ?? []).map((entry) => ({
    label: agentLabel(entry.agentSlug),
    count: entry.count,
  }));
  // Lead with the MODEL, not the provider: providers are often identical across
  // rows, so a provider-first label truncates to the same useless prefix and
  // hides the only part that differs. The full `provider / model` rides in the
  // hover title.
  const modelItems: BreakdownItem[] = (health?.byModel ?? []).map((entry) => ({
    label: entry.model,
    title: entry.provider ? `${entry.provider} / ${entry.model}` : entry.model,
    count: entry.count,
  }));

  // Every classified code has a short `chatHealth.errorType.<code>` label
  // (constant prefix → covered by the i18n usage scanner's wildcard).
  const errorTypeLabel = (code: string): string =>
    t(`chatHealth.errorType.${code}`);

  // Error-type shares read against the error total, so the bars express "what
  // share of failures is this kind" rather than a share of all turns.
  const errorTotal = summary?.errorCount ?? 0;
  const errorTypeItems: BreakdownItem[] = (health?.errorsByType ?? []).map(
    (entry) => ({ label: errorTypeLabel(entry.key), count: entry.count }),
  );
  const recentErrorItems: RecentErrorRow[] = (health?.recentErrors ?? []).map(
    (entry, i) => ({
      key: `${entry.at}-${i}`,
      time: formatDateSmart(new Date(entry.at)),
      typeLabel: errorTypeLabel(entry.type),
      model: entry.model ?? '—',
      agentSlug: entry.agentSlug ?? '—',
    }),
  );

  const kindItems: BreakdownItem[] = (guardrails?.byKind ?? []).map(
    (entry) => ({
      label: KIND_LABEL_KEY[entry.key]
        ? tGov(KIND_LABEL_KEY[entry.key])
        : entry.key,
      count: entry.count,
    }),
  );
  const filterItems: BreakdownItem[] = (guardrails?.byFilter ?? []).map(
    (entry) => ({
      label: FILTER_LABEL_KEY[entry.key]
        ? tGov(FILTER_LABEL_KEY[entry.key])
        : entry.key,
      count: entry.count,
    }),
  );
  const guardrailTotal = (guardrails?.byKind ?? []).reduce(
    (acc, entry) => acc + entry.count,
    0,
  );
  const guardrailBlocked =
    guardrails?.byKind.find((entry) => entry.key === 'blocked')?.count ?? 0;

  const turnsTooltip = (count: number): string =>
    t('chatHealth.routing.turnsTooltip', { count: formatNumber(count) });
  const eventsTooltip = (count: number): string =>
    t('chatHealth.guardrails.eventsTooltip', { count: formatNumber(count) });

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
          {summary?.capped || guardrails?.capped ? (
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
          label={t('chatHealth.cards.messages')}
          value={formatNumber(totalTurns)}
        />
        <StatCard
          label={t('chatHealth.cards.errorRate')}
          value={formatPct(summary?.errorRate ?? 0)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.errorRateDetail', {
              errors: formatNumber(summary?.errorCount ?? 0),
              total: formatNumber(totalTurns),
            })}
          </Text>
        </StatCard>
        <StatCard
          label={t('chatHealth.cards.blockedRate')}
          value={formatPct(summary?.blockedRate ?? 0)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.blockedRateDetail', {
              blocked: formatNumber(summary?.blockedCount ?? 0),
              total: formatNumber(totalTurns),
            })}
          </Text>
        </StatCard>
        <StatCard
          label={t('chatHealth.cards.guardrailEvents')}
          value={formatNumber(guardrailTotal)}
        >
          <Text variant="caption">
            {t('chatHealth.cards.guardrailEventsDetail', {
              blocked: formatNumber(guardrailBlocked),
            })}
          </Text>
        </StatCard>
      </StatCardGrid>

      <TurnTrendChart series={health?.series ?? []} />

      <MetricsSection title={t('chatHealth.breakdown.title')}>
        {/* 1 column on small screens, 2 on md+ — agents left, models right;
            long model IDs truncate with the full name in the hover title. */}
        <Grid md={2} gap={6}>
          <BreakdownList
            title={t('chatHealth.routing.byAgent')}
            items={agentItems}
            total={totalTurns}
            countTooltip={turnsTooltip}
          />
          <BreakdownList
            title={t('chatHealth.routing.byModel')}
            items={modelItems}
            total={totalTurns}
            countTooltip={turnsTooltip}
          />
        </Grid>
      </MetricsSection>

      <MetricsSection title={t('chatHealth.errorBreakdown.title')}>
        {/* Same responsive grid: 1 column on small, 2 on md+. The
            recent-errors list is a wide table, so it spans the full width. */}
        <Grid md={2} gap={6}>
          <BreakdownList
            title={t('chatHealth.errorBreakdown.byType')}
            items={errorTypeItems}
            total={errorTotal}
            countTooltip={turnsTooltip}
          />
          <div className="md:col-span-2">
            <RecentErrorsList items={recentErrorItems} />
          </div>
        </Grid>
      </MetricsSection>

      <MetricsSection title={t('chatHealth.guardrails.title')}>
        <Grid md={2} gap={6}>
          <BreakdownList
            title={t('chatHealth.guardrails.byKind')}
            items={kindItems}
            total={guardrailTotal}
            countTooltip={eventsTooltip}
          />
          <BreakdownList
            title={t('chatHealth.guardrails.byFilter')}
            items={filterItems}
            total={guardrailTotal}
            countTooltip={eventsTooltip}
          />
          <div className="md:col-span-2">
            <GuardrailTrendChart series={guardrails?.series ?? []} />
          </div>
        </Grid>
      </MetricsSection>
    </MetricsLayout>
  );
}

// Container — owns the two metrics queries and the validated period handler.
// Wraps the view in `<Skeletonize>` while they load. Error / empty-org
// branches are distinct layouts and stay here as early returns (mirrors the
// feedback page).
export function ChatHealthMetricsPage({
  organizationId,
  period,
  onChangePeriod,
}: ChatHealthMetricsPageProps) {
  const { t } = useT('analytics');

  const periodDays = periodToDays(period);
  const {
    data: health,
    isLoading: healthLoading,
    error,
  } = useConvexQuery(
    'chat/messages:getOrgChatHealth',
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );
  // Both queries sit behind the same admin gate, so a denial fails them
  // together; a lone guardrails hiccup degrades to an empty section instead of
  // failing the page.
  const { data: guardrails, isLoading: guardrailsLoading } = useConvexQuery(
    'chat_filter_events/queries:getGuardrailStats',
    { organizationId, periodDays },
    { enabled: !!organizationId },
  );
  const isLoading = healthLoading || guardrailsLoading;

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

  // Org has never produced chat traffic — a teaching panel, not empty KPIs.
  if (!isLoading && health && !health.summary.hasAnyData) {
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

  if (!isLoading && !health) {
    return (
      <Alert
        variant="destructive"
        icon={AlertTriangle}
        title={t('chatHealth.errors.unauthorized')}
      />
    );
  }

  const isPeriodEmpty =
    !isLoading &&
    !!health?.summary.hasAnyData &&
    (health?.summary.totalTurns ?? 0) === 0;

  return (
    <Skeletonize loading={isLoading} label={t('chatHealth.title')}>
      <ChatHealthMetricsPageView
        health={health ?? null}
        guardrails={guardrails ?? null}
        period={period}
        isPeriodEmpty={isPeriodEmpty}
        onChangePeriod={handleChangePeriod}
      />
    </Skeletonize>
  );
}
