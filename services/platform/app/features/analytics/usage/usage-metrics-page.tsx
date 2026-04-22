'use client';

import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Select } from '@/app/components/ui/forms/select';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { TopAgentsTable } from './top-agents-table';
import { TopModelsTable } from './top-models-table';
import { UsageSummaryCards } from './usage-summary-cards';
import {
  UsageTrendChart,
  type UsageGranularity,
  type UsageMetric,
} from './usage-trend-chart';
import { UsersTable } from './users-table';

export interface UsageMetricsPageProps {
  organizationId: string;
}

export function UsageMetricsPage({ organizationId }: UsageMetricsPageProps) {
  const { t } = useT('analytics');

  const [periodDays, setPeriodDays] = useState<7 | 30 | 90>(30);
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
  );

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('usage.period.last7Days') },
      { value: '30', label: t('usage.period.last30Days') },
      { value: '90', label: t('usage.period.last90Days') },
    ],
    [t],
  );
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
  const users = data?.users ?? [];

  const handlePeriod = useCallback((v: string) => {
    if (v === '7') setPeriodDays(7);
    else if (v === '90') setPeriodDays(90);
    else setPeriodDays(30);
  }, []);
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

  const hasFilters =
    agentSlug !== undefined || model !== undefined || provider !== undefined;

  const tableSkeleton = (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-66 w-full rounded-md" />
    </div>
  );

  const skeleton = (
    <Stack gap={6}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </div>
      </div>
      <div className="border-border grid grid-cols-2 overflow-hidden rounded-lg border md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-border flex flex-col gap-2 border-r px-5 py-6 last:border-r-0"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-92 w-full rounded-md" />
      <div className="flex flex-col gap-8">
        {tableSkeleton}
        {tableSkeleton}
        {tableSkeleton}
      </div>
    </Stack>
  );

  if (isLoading) {
    return <div aria-busy="true">{skeleton}</div>;
  }

  return (
    <Stack gap={6}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Text as="h3" className="text-foreground text-base font-semibold">
            {t('usage.title')}
          </Text>
          <Text variant="caption">{t('usage.description')}</Text>
        </div>
        <HStack gap={2} className="flex-wrap">
          <div className="w-36">
            <Select
              options={periodOptions}
              value={String(periodDays)}
              onValueChange={handlePeriod}
              size="sm"
              aria-label={t('usage.period.label')}
            />
          </div>
          <div className="w-36">
            <Select
              options={granularityOptions}
              value={granularity}
              onValueChange={handleGranularity}
              size="sm"
              aria-label={t('usage.granularity.label')}
            />
          </div>
          <div className="w-36">
            <Select
              options={metricOptions}
              value={metric}
              onValueChange={handleMetric}
              size="sm"
              aria-label={t('usage.metric.label')}
            />
          </div>
        </HStack>
      </div>

      {hasFilters ? (
        <HStack gap={2} className="flex-wrap items-center">
          {agentSlug ? (
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={() => setAgentSlug(undefined)}
            >
              {t('usage.filterChips.agent', { value: agentSlug })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          {model ? (
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={() => setModel(undefined)}
            >
              {t('usage.filterChips.model', { value: model })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          {provider ? (
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={() => setProvider(undefined)}
            >
              {t('usage.filterChips.provider', { value: provider })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t('usage.filterChips.clear')}
          </Button>
        </HStack>
      ) : null}

      {summary?.capped ? (
        <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-xs">
          {t('usage.cappedNotice')}
        </div>
      ) : null}

      <UsageSummaryCards
        totalRequests={summary?.totalRequests ?? 0}
        totalTokens={summary?.totalTokens ?? 0}
        totalCostCents={summary?.totalCostCents ?? 0}
        activeUsers={summary?.activeUsers ?? 0}
      />

      <UsageTrendChart
        series={series}
        metric={metric}
        granularity={granularity}
      />

      <TopAgentsTable
        rows={topAgents}
        isLoading={isLoading}
        onSelectAgent={setAgentSlug}
      />

      <TopModelsTable
        rows={topModels}
        isLoading={isLoading}
        onSelectModel={setModel}
      />

      <UsersTable rows={users} isLoading={isLoading} />
    </Stack>
  );
}
