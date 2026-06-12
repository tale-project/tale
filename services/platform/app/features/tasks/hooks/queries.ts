import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useTasksByProject(
  projectId: Id<'projects'> | undefined,
  options?: {
    includeArchived?: boolean;
    status?:
      | 'backlog'
      | 'todo'
      | 'in_progress'
      | 'in_review'
      | 'done'
      | 'cancelled';
    assigneeId?: string;
  },
) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTasksByProject,
    projectId
      ? {
          projectId,
          includeArchived: options?.includeArchived,
          status: options?.status,
          assigneeId: options?.assigneeId,
        }
      : 'skip',
  );
  return {
    tasks: data?.tasks ?? [],
    truncated: data?.truncated ?? false,
    isLoading,
  };
}

export function useTask(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.getTask,
    taskId ? { taskId } : 'skip',
  );
  return {
    task: data?.task ?? null,
    canEdit: data?.canEdit ?? false,
    canClaim: data?.canClaim ?? false,
    isLoading,
  };
}

export function useSubtasks(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listSubtasks,
    taskId ? { taskId } : 'skip',
  );
  return { subtasks: data ?? [], isLoading };
}

export function useTaskDependencies(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskDependencies,
    taskId ? { taskId } : 'skip',
  );
  return {
    blockedBy: data?.blockedBy ?? [],
    blocks: data?.blocks ?? [],
    isLoading,
  };
}

export function useProjectDependencies(projectId: Id<'projects'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listProjectDependencies,
    projectId ? { projectId } : 'skip',
  );
  return { edges: data ?? [], isLoading };
}

export function useTaskComments(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskComments,
    taskId ? { taskId } : 'skip',
  );
  return { comments: data ?? [], isLoading };
}

export function useTaskActivity(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskActivity,
    taskId ? { taskId } : 'skip',
  );
  return { activity: data ?? [], isLoading };
}

export function useTaskOpsIndicators(projectId: Id<'projects'> | undefined) {
  const { data } = useConvexQuery(
    api.tasks.queries.getTaskOpsIndicators,
    projectId ? { projectId } : 'skip',
  );
  return {
    runningTaskIds: data?.runningTaskIds ?? [],
    reviewTaskIds: data?.pendingReviews.map((r) => r.taskId) ?? [],
  };
}

export function usePendingTaskReview(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.getPendingTaskReview,
    taskId ? { taskId } : 'skip',
  );
  return { review: data ?? null, isLoading };
}

export function useTaskAgentRuns(taskId: Id<'tasks'> | undefined) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.listTaskAgentRuns,
    taskId ? { taskId } : 'skip',
  );
  return { runs: data ?? [], isLoading };
}

/**
 * Trigger preview for @-mentions in the comment composer: per mentioned
 * agent slug, will posting put it to work — and if not, why. Pass an empty
 * slug list to skip the query entirely (no draft mentions).
 */
export function useMentionTriggerPreview(
  taskId: Id<'tasks'> | undefined,
  slugs: string[],
) {
  const { data, isLoading } = useConvexQuery(
    api.tasks.queries.mentionTriggerPreview,
    taskId && slugs.length > 0 ? { taskId, slugs } : 'skip',
  );
  return { previews: data ?? [], isLoading };
}
