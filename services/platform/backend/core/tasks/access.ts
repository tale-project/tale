/**
 * Who may create a task and who may work one — the ONE rule behind every
 * task door on the server and every task control in the app, which imports
 * this module as it is.
 *
 * - **Creating** a task is open to every member who can read the project.
 * - **Working** a task — editing its fields, assigning it, moving its
 *   status (a review decision included), starting, steering or stopping its
 *   agent, archiving it — is open to the project's editors (an Editor role or
 *   higher, `checkProjectAccess`'s `canEdit`), and to any reader for whom the
 *   task is their own: they created it, or they are its person assignee.
 *
 * Both need an active project: an archived one is read-only for everyone, and
 * each door answers that with its own code, so the flags below leave the
 * archive out. Everything around a task stays with the project's editors —
 * its settings, agents and files, and the label catalog.
 */

/** What a viewer may do with the tasks of one project. */
export interface TaskAccess {
  /** An editor of the project: may work every task in it. */
  canEdit: boolean;
  /** A reader of the project: may create tasks in it and work their own. */
  canCreate: boolean;
}

/** The fields of a task that say whose it is. */
export interface TaskOwnership {
  createdBy: string;
  createdByType: string;
  assigneeType?: string | null;
  assigneeId?: string | null;
}

/** The task flags a project access verdict grants, before any archive. */
export function taskAccessFrom(access: {
  canRead: boolean;
  canEdit: boolean;
}): TaskAccess {
  return { canEdit: access.canEdit, canCreate: access.canRead };
}

/**
 * Whether the task is the person's own: they created it, or it is assigned
 * to them. An agent, an automation or an import that created a task makes it
 * nobody's own, and so does an agent or automation assignee.
 */
export function isOwnTask(task: TaskOwnership, userId: string): boolean {
  return (
    (task.createdByType === 'user' && task.createdBy === userId) ||
    (task.assigneeType === 'user' && task.assigneeId === userId)
  );
}

/**
 * Whether the viewer may work the task. `userId` is optional so a view that
 * has not resolved the signed-in person yet answers as a stranger's task.
 */
export function canWorkTask(
  access: TaskAccess,
  task: TaskOwnership,
  userId: string | undefined,
): boolean {
  if (access.canEdit) return true;
  return access.canCreate && userId !== undefined && isOwnTask(task, userId);
}
