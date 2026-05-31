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
