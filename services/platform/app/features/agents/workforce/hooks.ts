import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import { useListAgents } from '../hooks/queries';
import { toConfigurableAgent } from '../utils/agent-list-item';

export interface WorkforceTrendPoint {
  dateKey: string;
  tasksCompleted: number;
  agentRunsStarted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
}

export interface WorkforceTotals {
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  agentCompleted: number;
  humanCompleted: number;
  agentRunsStarted: number;
  agentRunsCompleted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  leadTimeSumMs: number;
  leadTimeCount: number;
  capped: boolean;
}

export interface WorkforceLeaderboardRow {
  agentSlug: string;
  runsStarted: number;
  runsCompleted: number;
  runsFailed: number;
  runDurationSumMs: number;
  runDurationCount: number;
  costCents: number;
  tasksCompleted: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
}

/** Prior equal-length window totals (subset) — drives the KPI deltas. */
export interface WorkforcePreviousTotals {
  tasksCompleted: number;
  agentRunsStarted: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  totalCostCents: number;
}

export interface WorkforceMetricsPayload {
  totals: WorkforceTotals;
  previousTotals: WorkforcePreviousTotals;
  trend: WorkforceTrendPoint[];
  leaderboard: WorkforceLeaderboardRow[];
}

export interface WorkforceHealthPayload {
  automationEnabled: boolean;
  runsStarted24h: number;
  runsFailed24h: number;
  runsTimedOut24h: number;
  runsScanCapped: boolean;
  packFailures24h: number;
  oldestQueuedMs?: number;
  runtimesOffline: number;
}

export interface NeedsAttentionPayload {
  staleTasks: Array<{
    taskId: string;
    projectId: string;
    title: string;
    assigneeId?: string;
    staleSinceMs: number;
  }>;
  pendingReviews: Array<{
    approvalId: string;
    taskId?: string;
    taskTitle?: string;
    projectId?: string;
    agentSlug?: string;
    requestedAt: number;
  }>;
  queuedRuns: Array<{ agentSlug: string; taskId?: string; queuedAt: number }>;
  trippedBreakers: Array<{
    agentSlug: string;
    taskId?: string;
    trippedAt: number;
  }>;
}

export function useWorkforceMetrics(organizationId: string, days: number) {
  const { data, isLoading } = useConvexQuery(
    api.task_metrics.queries.getWorkforceMetrics,
    organizationId ? { organizationId, days } : 'skip',
  );
  // The query returns v.any(); the payload shape is owned by getWorkforceMetrics.
  const metrics: WorkforceMetricsPayload | undefined = data ?? undefined;
  return { metrics, isLoading };
}

export function useWorkforceHealth(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.task_metrics.queries.getWorkforceHealth,
    organizationId ? { organizationId } : 'skip',
  );
  const health: WorkforceHealthPayload | undefined = data ?? undefined;
  return { health, isLoading };
}

export function useNeedsAttention(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.task_metrics.queries.getNeedsAttention,
    organizationId ? { organizationId } : 'skip',
  );
  const attention: NeedsAttentionPayload | undefined = data ?? undefined;
  return { attention, isLoading };
}

export function useSetTaskAutomation() {
  return useConvexAction(api.governance.mutations.setTaskAutomationEnabled);
}

/**
 * Resolves an agent slug to its locale-aware display name for the workforce
 * surfaces (leaderboard + needs-attention lists). The metrics queries are
 * reactive DB reads and the agent display names live in config FILES (only the
 * Node-runtime `listAgents` action can read them), so the backend payload
 * carries only `agentSlug`. We resolve the friendly name client-side from the
 * same roster the agents List uses — keeping the slug as the fallback (and for
 * the routing param), so an unknown/uninstalled slug still renders sensibly.
 *
 * App-owned agents key on their composite `<appSlug>/<name>` slug, which is the
 * same value the metrics rollups record, so those resolve too.
 */
export function useAgentDisplayName(
  organizationId: string,
): (slug: string) => string {
  const { agents } = useListAgents(organizationId);
  const { i18n } = useTranslation();
  const locale = i18n.language;

  const bySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const raw of agents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      const { displayName } = resolveAgentLocale(agent, locale);
      if (displayName) map.set(agent.name, displayName);
    }
    return map;
  }, [agents, locale]);

  return useMemo(() => (slug: string) => bySlug.get(slug) ?? slug, [bySlug]);
}
