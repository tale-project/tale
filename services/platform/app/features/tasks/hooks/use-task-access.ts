import { useCallback, useMemo } from 'react';

import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import {
  canWorkTask as taskIsWorkable,
  type TaskAccess,
  type TaskOwnership,
} from '@/backend/core/tasks/access';

export interface TaskAccessView extends TaskAccess {
  /** Whether the signed-in person may work this task: edit it, assign it,
   * move it, run its agent, archive it. */
  canWorkTask: (task: TaskOwnership) => boolean;
}

/**
 * The app's side of the task rule (`backend/core/tasks/access.ts`, the same
 * function every task door on the server enforces): the access flags a board
 * or task read answers, decided per task for the signed-in person. Controls
 * that change one task ask `canWorkTask(task)`; controls around the tasks —
 * the label catalog, project files — ask `canEdit`; the create affordance
 * asks `canCreate`. Until the person is known, only an editor works a task.
 */
export function useTaskAccess(
  organizationId: string | undefined,
  access: TaskAccess,
): TaskAccessView {
  const { data: me } = useCurrentMemberContext(organizationId);
  const userId = me?.userId;
  const { canEdit, canCreate } = access;
  const canWorkTask = useCallback(
    (task: TaskOwnership) =>
      taskIsWorkable({ canEdit, canCreate }, task, userId),
    [canEdit, canCreate, userId],
  );
  return useMemo(
    () => ({ canEdit, canCreate, canWorkTask }),
    [canEdit, canCreate, canWorkTask],
  );
}
