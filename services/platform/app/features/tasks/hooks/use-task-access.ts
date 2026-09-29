import { useCallback, useMemo } from 'react';

import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import {
  canControlLiveRun as liveRunIsControllable,
  canWorkTask as taskIsWorkable,
  TASK_ANCESTRY_DEPTH_MAX,
  type TaskAccess,
  type TaskOwnership,
} from '@/backend/core/tasks/access';

/** A task as the rule reads it here: whose it is, and its parent. */
export type AccessTask = TaskOwnership & { parentTaskId?: string | null };

export interface TaskAccessView extends TaskAccess {
  /** Whether the signed-in person may work this task: edit it, assign it,
   * move it, run its agent, archive it. `ancestors` are the task's parents,
   * nearest first, when the caller has them; otherwise they are looked up
   * among the tasks the view knows. */
  canWorkTask: (
    task: AccessTask,
    ancestors?: readonly TaskOwnership[],
  ) => boolean;
  /** Whether the signed-in person may stop or steer the task's live agent
   * run: whoever may work the task, and the person who started the run. */
  canControlLiveRun: (
    task: AccessTask,
    liveRunStartedBy: string | null | undefined,
    ancestors?: readonly TaskOwnership[],
  ) => boolean;
}

/**
 * The app's side of the task rule (`backend/core/tasks/access.ts`, the same
 * functions every task door on the server enforces): the access flags a board
 * or task read answers, decided per task for the signed-in person. Controls
 * that change one task ask `canWorkTask(task)`; controls around the tasks —
 * the label catalog, project files — ask `canEdit`; the create affordance
 * asks `canCreate`. Until the person is known, only an editor works a task.
 *
 * Work rights run down the subtask tree, so a subtask's parents count:
 * `resolveTask` finds a parent among the tasks the view has loaded (a board,
 * a list), and a view that read the parents itself passes them instead.
 */
export function useTaskAccess(
  organizationId: string | undefined,
  access: TaskAccess,
  resolveTask?: (taskId: string) => AccessTask | undefined,
): TaskAccessView {
  const { data: me } = useCurrentMemberContext(organizationId);
  const userId = me?.userId;
  const { canEdit, canCreate } = access;
  const ancestorsOf = useCallback(
    (task: AccessTask): TaskOwnership[] => {
      const chain: TaskOwnership[] = [];
      if (resolveTask === undefined) return chain;
      let parentId = task.parentTaskId;
      while (parentId != null && chain.length < TASK_ANCESTRY_DEPTH_MAX) {
        const parent = resolveTask(parentId);
        if (parent === undefined) break;
        chain.push(parent);
        parentId = parent.parentTaskId;
      }
      return chain;
    },
    [resolveTask],
  );
  const canWorkTask = useCallback(
    (task: AccessTask, ancestors?: readonly TaskOwnership[]) =>
      taskIsWorkable(
        { canEdit, canCreate },
        task,
        userId,
        ancestors ?? ancestorsOf(task),
      ),
    [canEdit, canCreate, userId, ancestorsOf],
  );
  const canControlLiveRun = useCallback(
    (
      task: AccessTask,
      liveRunStartedBy: string | null | undefined,
      ancestors?: readonly TaskOwnership[],
    ) =>
      liveRunIsControllable(
        { canEdit, canCreate },
        task,
        userId,
        liveRunStartedBy,
        ancestors ?? ancestorsOf(task),
      ),
    [canEdit, canCreate, userId, ancestorsOf],
  );
  return useMemo(
    () => ({ canEdit, canCreate, canWorkTask, canControlLiveRun }),
    [canEdit, canCreate, canWorkTask, canControlLiveRun],
  );
}
