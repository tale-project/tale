import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';

type TaskStatusFilter =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'cancelled';

export function useTasksByProject(
  projectId: string | undefined,
  options?: {
    includeArchived?: boolean;
    status?: TaskStatusFilter;
    /** Only tasks whose status is in this set (server-side view scoping). */
    statuses?: TaskStatusFilter[];
    assigneeId?: string;
  },
) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTasksByProject',
    projectId && organizationId
      ? {
          projectId,
          organizationId,
          includeArchived: options?.includeArchived,
          status: options?.status,
          statuses: options?.statuses,
          assigneeId: options?.assigneeId,
        }
      : 'skip',
  );
  return {
    tasks: data?.tasks ?? [],
    truncated: data?.truncated ?? false,
    // Defaults to false until the read resolves, so write controls stay hidden
    // (rather than flashing) for a viewer who turns out to be read-only.
    canEdit: data?.canEdit ?? false,
    isLoading,
  };
}

/** All-projects board: every task in projects the caller can read. */
export function useTasksAcrossProjects(options?: {
  includeArchived?: boolean;
  status?: TaskStatusFilter;
  statuses?: TaskStatusFilter[];
  assigneeId?: string;
  /** When false the query is skipped (single-project mode owns the board). */
  enabled?: boolean;
}) {
  const organizationId = useOrganizationId();
  const enabled = options?.enabled !== false;
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTasksForAccessibleProjects',
    enabled && organizationId
      ? {
          organizationId,
          includeArchived: options?.includeArchived,
          status: options?.status,
          statuses: options?.statuses,
          assigneeId: options?.assigneeId,
        }
      : 'skip',
  );
  return {
    tasks: data?.tasks ?? [],
    truncated: data?.truncated ?? false,
    canEdit: data?.canEdit ?? false,
    isLoading,
  };
}

export function useTask(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:getTask',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return {
    task: data?.task ?? null,
    canEdit: data?.canEdit ?? false,
    canClaim: data?.canClaim ?? false,
    // Commenting is read-level: default false until the read resolves so the
    // composer doesn't flash, then true for any member who can open the task.
    canComment: data?.canComment ?? false,
    isLoading,
  };
}

export function useSubtasks(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listSubtasks',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return { subtasks: data ?? [], isLoading };
}

export function useTaskLabels(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTaskLabels',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { labels: data ?? [], isLoading };
}

export function useTaskDependencies(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTaskDependencies',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return {
    blockedBy: data?.blockedBy ?? [],
    blocks: data?.blocks ?? [],
    isLoading,
  };
}

export function useProjectDependencies(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listProjectDependencies',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { edges: data ?? [], isLoading };
}

export function useTaskDiscussion(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:getTaskDiscussion',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return {
    threadId: data?.threadId ?? null,
    comments: data?.messages ?? [],
    isLoading,
  };
}

export function useTaskActivity(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTaskActivity',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return { activity: data ?? [], isLoading };
}

export function useTaskOpsIndicators(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data } = useConvexQuery(
    'tasks/queries:getTaskOpsIndicators',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return {
    runningTaskIds: data?.runningTaskIds ?? [],
    // Live runs parked on an unanswered agent question — the board shows the
    // needs-answer chip instead of the working pulse for these.
    askingTaskIds: data?.askingTaskIds ?? [],
    // Full pending-review refs (taskId + the reviewer waited on) — the board
    // chip naming and the needs-my-review facet both read `requestedFor`.
    pendingReviews: data?.pendingReviews ?? [],
  };
}

/** All-projects sibling of {@link useTaskOpsIndicators}. */
export function useTaskOpsIndicatorsAcrossProjects(enabled = true) {
  const organizationId = useOrganizationId();
  const { data } = useConvexQuery(
    'tasks/queries:getTaskOpsIndicatorsForAccessibleProjects',
    enabled && organizationId ? { organizationId } : 'skip',
  );
  return {
    runningTaskIds: data?.runningTaskIds ?? [],
    // Always empty today: the aggregate query omits automation-run indicators
    // (see getTaskOpsIndicatorsForAccessibleProjects), the ask set with them.
    askingTaskIds: data?.askingTaskIds ?? [],
    pendingReviews: data?.pendingReviews ?? [],
  };
}

export function useTaskAgentRuns(taskId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:listTaskAgentRuns',
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return { runs: data ?? [], isLoading };
}

/**
 * Trigger preview for @-mentions in the comment and description composers:
 * per mentioned agent slug, will saving put it to work — and if not, why.
 * Pass an empty slug list to skip the query entirely (no draft mentions).
 * Create mode (no task yet) passes `projectId` instead of `taskId`.
 */
export function useMentionTriggerPreview(
  target: { taskId: string } | { projectId: string } | undefined,
  slugs: string[],
) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    'tasks/queries:mentionTriggerPreview',
    target && slugs.length > 0 && organizationId
      ? { ...target, organizationId, slugs }
      : 'skip',
  );
  return { previews: data ?? [], isLoading };
}

/** Whether the viewer follows this task, and whether they've silenced it. */
export function useTaskSubscription(taskId: string | undefined) {
  const { data, isLoading } = useConvexQuery(
    'collab/subscriptions:isSubscribedToTask',
    taskId ? { taskId } : 'skip',
  );
  return {
    subscribed: data?.subscribed ?? false,
    muted: data?.muted ?? false,
    isLoading,
  };
}
