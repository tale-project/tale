'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { FunctionReturnType } from 'convex/server';
import { useCallback, useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { useActivitySummary } from '../hooks/queries';

type ActivitySummary = FunctionReturnType<
  typeof api.audit_logs.queries.getActivitySummary
>;

interface ActivityLogViewProps {
  organizationId: string;
  userEmailMap?: Map<string, string>;
}

interface ActivityLogViewInnerProps {
  summary: ActivitySummary | undefined;
  isLoading: boolean;
  periodDays: 7 | 30 | 90;
  onPeriod: (value: string) => void;
  userEmailMap?: Map<string, string>;
}

function StatCell({ label, value }: { label: string; value: string }) {
  const loading = useSkeleton();

  return (
    <div className="flex flex-1 flex-col gap-1 p-5">
      <Text className="text-muted-foreground text-sm">{label}</Text>
      {/* Mask the async value to its natural line box so the card height is
          identical loading vs loaded and the number doesn't flash from 0. */}
      <Text className="text-foreground font-mono text-2xl font-semibold">
        {loading ? (
          <SkeletonBox>
            <span className="my-0.5 inline-block h-7 w-16" />
          </SkeletonBox>
        ) : (
          value
        )}
      </Text>
    </div>
  );
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
  return (
    <HStack gap={3} className="items-center">
      <Text as="span" variant="body" truncate className="w-32 shrink-0">
        {label}
      </Text>
      <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.max((count / maxCount) * 100, 2)}%` }}
        />
      </div>
      <Text
        as="span"
        variant="muted"
        className="w-14 shrink-0 text-right font-mono text-xs"
      >
        {formatNumber(count)}
      </Text>
    </HStack>
  );
}

function BreakdownSkeletonRows() {
  return (
    <Stack gap={3}>
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonBox key={i}>
          <div className="h-5 w-full" />
        </SkeletonBox>
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
}: ActivityLogViewInnerProps) {
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

  return (
    <Stack gap={6}>
      <HStack gap={2} className="justify-end">
        <div className="w-36">
          <Select
            options={periodOptions}
            value={String(periodDays)}
            onValueChange={onPeriod}
            size="sm"
            aria-label={t('logs.activity.period.label')}
          />
        </div>
      </HStack>

      <div className="border-border divide-border grid grid-cols-2 divide-y rounded-lg border md:grid-cols-4 md:divide-x md:divide-y-0">
        <StatCell
          label={t('logs.activity.cards.total')}
          value={formatNumber(summary?.totalActions ?? 0)}
        />
        <StatCell
          label={t('logs.activity.cards.success')}
          value={formatNumber(summary?.successCount ?? 0)}
        />
        <StatCell
          label={t('logs.activity.cards.failure')}
          value={formatNumber(summary?.failureCount ?? 0)}
        />
        <StatCell
          label={t('logs.activity.cards.denied')}
          value={formatNumber(summary?.deniedCount ?? 0)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        userEmailMap={userEmailMap}
      />
    </Skeletonize>
  );
}
