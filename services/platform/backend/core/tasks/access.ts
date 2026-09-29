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
 *   Work rights run down the subtask tree: a subtask under a task someone
 *   may work is theirs to work too, whoever added it (an agent breaking the
 *   work down, an editor helping), so it never blocks them from closing
 *   their own task.
 * - **Stopping or steering a live agent run** is also open to the person
 *   who started that run, even once the task is no longer theirs (handing
 *   an assigned task to an agent makes the agent its assignee).
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
 * How far up the subtask tree the rule looks for an owner. Real trees are
 * a level or two deep; the bound keeps a corrupt parent chain from turning
 * one check into an unbounded walk.
 */
export const TASK_ANCESTRY_DEPTH_MAX = 16;

/**
 * Whether the viewer may work the task. `ancestors` are the task's parents,
 * nearest first (the caller walks up to {@link TASK_ANCESTRY_DEPTH_MAX});
 * a task under one of the viewer's own tasks is theirs to work too. `userId`
 * is optional so a view that has not resolved the signed-in person yet
 * answers as a stranger's task.
 */
export function canWorkTask(
  access: TaskAccess,
  task: TaskOwnership,
  userId: string | undefined,
  ancestors: readonly TaskOwnership[] = [],
): boolean {
  if (access.canEdit) return true;
  if (!access.canCreate || userId === undefined) return false;
  return (
    isOwnTask(task, userId) ||
    ancestors.some((ancestor) => isOwnTask(ancestor, userId))
  );
}

/**
 * Whether the viewer may stop or steer the task's live agent run: whoever
 * may work the task, and the person who started that run while they can
 * still read the project. `liveRunStartedBy` is the live run's starter, or
 * absent when no run is live.
 */
export function canControlLiveRun(
  access: TaskAccess,
  task: TaskOwnership,
  userId: string | undefined,
  liveRunStartedBy: string | null | undefined,
  ancestors: readonly TaskOwnership[] = [],
): boolean {
  if (canWorkTask(access, task, userId, ancestors)) return true;
  return (
    access.canCreate &&
    userId !== undefined &&
    liveRunStartedBy != null &&
    liveRunStartedBy === userId
  );
}
