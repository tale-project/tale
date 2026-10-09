'use client';

import {
  DataTableFilters,
  type FilterConfig,
} from '@tale/ui/data-table/data-table-filters';
import { isFilterAffordanceDisabled } from '@tale/ui/filters/filter-panel';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { useActivitySummary } from '../hooks/queries';

type ActivitySummary = ReturnsOf<'audit_logs/queries:getActivitySummary'>;

interface ActivityLogViewProps {
  organizationId: string;
  userEmailMap?: Map<string, string>;
  /** Page-level controls (the export menu) rendered in the filter bar's
   *  actions slot so they share the filter button's baseline. */
  actions?: ReactNode;
}

interface ActivityLogViewInnerProps {
  summary: ActivitySummary | undefined;
  isLoading: boolean;
  periodDays: 7 | 30 | 90;
  onPeriod: (value: string) => void;
  userEmailMap?: Map<string, string>;
  actions?: ReactNode;
}

function BreakdownRow({
  label,
  count,
  maxCount,
}: {
  label: string;
  count: number;
  maxCount: number;
}) {
  const { locale } = useLocale();

  return (
    <HStack gap={3} className="items-center">
      <Text as="span" variant="body" truncate className="w-32 shrink-0">
        <SkeletonBox fullWidth>{label}</SkeletonBox>
      </Text>
      <SkeletonBox asChild>
        <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${Math.max((count / maxCount) * 100, 2)}%` }}
          />
        </div>
      </SkeletonBox>
      <Text
        as="span"
        variant="muted"
        className="w-14 shrink-0 text-right font-mono text-xs"
      >
        <SkeletonBox>{formatNumber(count, locale)}</SkeletonBox>
      </Text>
    </HStack>
  );
}

function BreakdownSkeletonRows() {
  return (
    <Stack gap={3}>
      {[0, 1, 2, 3, 4].map((i) => (
        <BreakdownRow key={i} label={'\u00a0'} count={0} maxCount={1} />
      ))}
    </Stack>
  );
}

function BreakdownPanel({
  title,
  empty,
  isLoading,
  children,
}: {
  title: string;
  empty: boolean;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  const { t } = useT('settings');

  return (
    <Stack gap={3} className="border-border min-w-0 rounded-lg border p-5">
      <Text as="h3" className="text-foreground text-sm font-medium">
        {title}
      </Text>
      {isLoading ? (
        <BreakdownSkeletonRows />
      ) : empty ? (
        <Text variant="muted" className="text-sm">
          {t('logs.activity.empty')}
        </Text>
      ) : (
        children
      )}
    </Stack>
  );
}

function ActivityLogViewInner({
  summary,
  isLoading,
  periodDays,
  onPeriod,
  userEmailMap,
  actions,
}: ActivityLogViewInnerProps) {
  const { locale } = useLocale();
  const { t } = useT('settings');

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('logs.activity.period.last7Days') },
      { value: '30', label: t('logs.activity.period.last30Days') },
      { value: '90', label: t('logs.activity.period.last90Days') },
    ],
    [t],
  );

  const categories = useMemo(() => {
    const entries = Object.entries(summary?.byCategory ?? {});
    return entries.sort((a, b) => b[1] - a[1]);
  }, [summary?.byCategory]);
  const maxCategoryCount = categories[0]?.[1] ?? 1;

  const topActors = summary?.topActors ?? [];
  const maxActorCount = topActors[0]?.count ?? 1;
  const periodLabel =
    periodOptions.find((option) => option.value === String(periodDays))
      ?.label ?? '';

  const filters: FilterConfig[] = [
    {
      key: 'period',
      title: t('logs.activity.period.label'),
      options: periodOptions,
      selectedValues: [String(periodDays)],
      // The view opens on the 7-day window, so that selection is the
      // resting state: no active-filter dot, and clearing returns here.
      defaultValues: ['7'],
      onChange: (values) => onPeriod(values[0] ?? '7'),
      // A longer window reveals actions the 7-day one leaves out, so a quiet
      // week must not lock the reader out of the 30- and 90-day views.
      widensResultSet: true,
    },
  ];

  return (
    <Stack gap={6}>
      {/* Same filter affordance as the sibling log views — a filter button,
          left-aligned in the view's toolbar row, with the page's export menu
          in the actions slot on the same baseline. Single-select; clearing it
          falls back to the default period rather than an unfiltered view,
          because the summary always needs a window. The period widens the
          result set, so the shared disabled rule below never fires while it
          is on the bar — not even for a narrowing filter added beside it. */}
      <DataTableFilters
        filters={filters}
        disabled={isFilterAffordanceDisabled({
          isLoading,
          itemCount: summary?.totalActions ?? 0,
          hasActiveFilters: periodDays !== 7,
          filters,
        })}
        actions={actions}
      />

      <Stack gap={2}>
        {/* The window every number below covers. The filter's pick sits
            behind an icon button and the 7-day default is its resting
            state, so nothing else on the tab named it and "1,310 actions"
            read as an all-time total (2026-09-26 evaluation, E-03). */}
        <Text variant="muted" className="text-sm">
          {t('logs.activity.periodCaption', { period: periodLabel })}
        </Text>
        <StatCardGrid>
          <StatCard
            label={t('logs.activity.cards.total')}
            value={formatNumber(summary?.totalActions ?? 0, locale)}
          />
          <StatCard
            label={t('logs.activity.cards.success')}
            value={formatNumber(summary?.successCount ?? 0, locale)}
          />
          <StatCard
            label={t('logs.activity.cards.failure')}
            value={formatNumber(summary?.failureCount ?? 0, locale)}
          />
          <StatCard
            label={t('logs.activity.cards.denied')}
            value={formatNumber(summary?.deniedCount ?? 0, locale)}
          />
        </StatCardGrid>
      </Stack>

      {/* Two breakdowns side by side once the settings column is 42rem
          wide — the column, not the viewport, which also holds the rail and
          the settings panel. */}
      <div className="@container">
        <Grid className="@2xl:grid-cols-2">
          <BreakdownPanel
            title={t('logs.activity.byCategory.title')}
            empty={categories.length === 0}
            isLoading={isLoading}
          >
            <Stack gap={3}>
              {categories.map(([category, count]) => (
                <BreakdownRow
                  key={category}
                  label={t('logs.audit.categoryLabels.' + category, {
                    defaultValue: category,
                  })}
                  count={count}
                  maxCount={maxCategoryCount}
                />
              ))}
            </Stack>
          </BreakdownPanel>

          <BreakdownPanel
            title={t('logs.activity.topActors.title')}
            empty={topActors.length === 0}
            isLoading={isLoading}
          >
            <Stack gap={3}>
              {topActors.map((actor) => (
                <BreakdownRow
                  key={actor.actorId}
                  label={
                    actor.actorEmail ??
                    userEmailMap?.get(actor.actorId) ??
                    actor.actorId
                  }
                  count={actor.count}
                  maxCount={maxActorCount}
                />
              ))}
            </Stack>
          </BreakdownPanel>
        </Grid>
      </div>
    </Stack>
  );
}

/**
 * "Activity logs" tab — aggregated view over the same audit trail the
 * Audit tab lists row-by-row: volume, outcome split, category breakdown,
 * and most active members for a selectable time window.
 */
export function ActivityLogView({
  organizationId,
  userEmailMap,
  actions,
}: ActivityLogViewProps) {
  const { t } = useT('settings');
  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(7);

  const { data, isLoading } = useActivitySummary(organizationId, periodDays);

  const handlePeriod = useCallback((value: string) => {
    if (value === '30') setPeriodDays(30);
    else if (value === '90') setPeriodDays(90);
    else setPeriodDays(7);
  }, []);

  return (
    <Skeletonize loading={isLoading} label={t('logs.activityLogs')}>
      <ActivityLogViewInner
        summary={data}
        isLoading={isLoading}
        periodDays={periodDays}
        onPeriod={handlePeriod}
        actions={actions}
        userEmailMap={userEmailMap}
      />
    </Skeletonize>
  );
}
