/**
 * Shared recipient resolution for start-reached / due-soon date alerts.
 *
 * Human assignee wins; otherwise the human task creator; otherwise the
 * project creator. Agent/app assignees cannot receive inbox rows, so they
 * fall through to the creator/project-creator chain.
 */

export type DateNotifyAudience =
  | 'task_assignee'
  | 'task_creator'
  | 'project_creator';

export function resolveDateNotifyAudience(row: {
  assigneeType?: string;
  assigneeId?: string;
  taskCreatorId?: string;
  projectCreatorId?: string;
}): DateNotifyAudience | null {
  if (row.assigneeType === 'user' && row.assigneeId) {
    return 'task_assignee';
  }
  if (row.taskCreatorId) {
    return 'task_creator';
  }
  if (row.projectCreatorId) {
    return 'project_creator';
  }
  return null;
}
