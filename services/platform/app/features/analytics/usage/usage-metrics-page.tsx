'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { FunctionReturnType } from 'convex/server';
import { X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
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
}

type UsageMetricsData =
  | FunctionReturnType<typeof api.governance.queries.getOrgUsageMetrics>
  | undefined;

interface UsageMetricsPageViewProps {
  organizationId: string;
  /** Resolved metrics payload; `undefined` while loading (masked by the
   *  enclosing `<Skeletonize>` — cards/chart/tables stand in at full height). */
  data: UsageMetricsData;
  isLoading: boolean;
  periodDays: 7 | 30 | 90;
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
  organizationId,
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
  const topVoiceModels = data?.topVoiceModels ?? [];
  const users = data?.users ?? [];

  const hasFilters =
    agentSlug !== undefined || model !== undefined || provider !== undefined;

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
              onValueChange={onPeriod}
              size="sm"
              aria-label={t('usage.period.label')}
            />
          </div>
          <div className="w-36">
            <Select
              options={granularityOptions}
              value={granularity}
              onValueChange={onGranularity}
              size="sm"
              aria-label={t('usage.granularity.label')}
            />
          </div>
          <div className="w-36">
            <Select
              options={metricOptions}
              value={metric}
              onValueChange={onMetric}
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
              onClick={() => onSelectAgent(undefined)}
            >
              {t('usage.filterChips.agent', { value: agentSlug })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          {model ? (
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={() => onSelectModel(undefined)}
            >
              {t('usage.filterChips.model', { value: model })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          {provider ? (
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={() => onSelectProvider(undefined)}
            >
              {t('usage.filterChips.provider', { value: provider })}
              <X className="ml-1 size-3" />
            </Badge>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClearAll}>
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
        onSelectAgent={onSelectAgent}
        organizationId={organizationId}
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
    </Stack>
  );
}

// =============================================================================
// Container — owns the filter/period state and the metrics query. Wraps the
// plain view in `<Skeletonize>` so the same tree renders the skeleton while
// the metrics load (no separate skeleton file to drift from the real layout).
// =============================================================================
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

  return (
    <Skeletonize loading={isLoading} label={t('usage.title')}>
      <UsageMetricsPageView
        organizationId={organizationId}
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
