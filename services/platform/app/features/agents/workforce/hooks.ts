import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

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

export interface WorkforceMetricsPayload {
  totals: WorkforceTotals;
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
