import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

type TaskStatusFilter =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'cancelled';

export function useTasksByProject(
  projectId: Id<'projects'> | undefined,
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
    api.tasks.queries.listTasksByProject,
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

export function useTask(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.getTask,
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

export function useSubtasks(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listSubtasks,
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return { subtasks: data ?? [], isLoading };
}

export function useTaskLabels(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskLabels,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { labels: data ?? [], isLoading };
}

export function useTaskDependencies(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskDependencies,
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return {
    blockedBy: data?.blockedBy ?? [],
    blocks: data?.blocks ?? [],
    isLoading,
  };
}

export function useProjectDependencies(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listProjectDependencies,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { edges: data ?? [], isLoading };
}

export function useTaskDiscussion(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.getTaskDiscussion,
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return {
    threadId: data?.threadId ?? null,
    comments: data?.messages ?? [],
    isLoading,
  };
}

export function useTaskActivity(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskActivity,
    taskId && organizationId ? { taskId, organizationId } : 'skip',
  );
  return { activity: data ?? [], isLoading };
}

export function useTaskOpsIndicators(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data } = useConvexQuery(
    api.tasks.queries.getTaskOpsIndicators,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return {
    runningTaskIds: data?.runningTaskIds ?? [],
    // Full pending-review refs (taskId + the reviewer waited on) — the board
    // chip naming and the needs-my-review facet both read `requestedFor`.
    pendingReviews: data?.pendingReviews ?? [],
  };
}

export function useTaskAgentRuns(taskId: Id<'tasks'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskAgentRuns,
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
  target: { taskId: Id<'tasks'> } | { projectId: Id<'projects'> } | undefined,
  slugs: string[],
) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.mentionTriggerPreview,
    target && slugs.length > 0 && organizationId
      ? { ...target, organizationId, slugs }
      : 'skip',
  );
  return { previews: data ?? [], isLoading };
}

/** Whether the viewer follows this task, and whether they've silenced it. */
export function useTaskSubscription(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.collab.subscriptions.isSubscribedToTask,
    taskId ? { taskId } : 'skip',
  );
  return {
    subscribed: data?.subscribed ?? false,
    muted: data?.muted ?? false,
    isLoading,
  };
}
