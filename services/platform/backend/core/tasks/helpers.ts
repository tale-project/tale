/**
 * Pure task helpers shared by the backend domain (`domains/tasks/*`) and the
 * app (`task-modal.tsx` reads the title limit) — the one home of the task
 * limits, so the UI's `maxLength` and the server's validator cannot drift.
 * The 0.4 Convex `ctx.db` bodies that used to live here (labels, counters,
 * ranks, activity) have their live twins in `domains/tasks/service.ts`.
 */

import { parseIssueNumber, parseRepoRef } from './issue_ref';

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_COMMENT_MAX = 10_000;
export const TASK_LABELS_MAX = 50;
export const TASK_LABEL_CHARS_MAX = 50;
/** Files a person can hang on one task (the dialog's attachments list). */
export const TASK_ATTACHMENTS_MAX = 50;

/**
 * Coerce an externally-sourced task title (e.g. a GitHub issue title) to fit
 * `TASK_TITLE_MAX`. Unlike the human/agent create paths — which *reject* an
 * over-long title so the author can shorten it — an imported title is not under
 * anyone's control at the import site (GitHub allows longer titles than our
 * board), so truncating with an ellipsis keeps the import working instead of
 * failing the whole task. The full title stays reachable via `externalUrl`.
 * Returns an empty string only when the input is blank; callers supply a
 * fallback for that (GitHub issues always carry a title, so it's defensive).
 */
export function truncateImportedTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TASK_TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…`;
}

/** The task fields a workflow-run subject is built from. */
export interface TaskWorkflowSubjectFields {
  _id: string;
  title: string;
  status: string;
  projectId: string;
  /** The external trio: only a task mirrored from an issue tracker has it. */
  externalSystem?: string;
  externalId?: string;
  externalUrl?: string;
}

/**
 * The `input.task` subject a task-workflow run receives — ONE builder for
 * every start door (task-board Start, create→run schedule, REST, the comment
 * `@automation` trigger), so the shape the workflow templates read
 * (`input.task.*`) cannot drift between them. The issue number and
 * `owner/repo` ref are derived from the task's `externalId`
 * ("owner/repo#N"); both are null-elided for non-issue tasks.
 */
export function taskWorkflowSubjectInput(task: TaskWorkflowSubjectFields): {
  task: Record<string, unknown>;
} {
  const issueNumber = parseIssueNumber(task.externalId);
  const repoRef = parseRepoRef(task.externalId);
  return {
    task: {
      id: task._id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      ...(task.externalSystem !== undefined
        ? { externalSystem: task.externalSystem }
        : {}),
      ...(task.externalId !== undefined ? { externalId: task.externalId } : {}),
      ...(task.externalUrl !== undefined
        ? { externalUrl: task.externalUrl }
        : {}),
      ...(issueNumber !== null ? { issueNumber } : {}),
      ...(repoRef !== null ? { repo: `${repoRef.owner}/${repoRef.repo}` } : {}),
    },
  };
}
