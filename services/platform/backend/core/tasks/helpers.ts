/**
 * Pure task helpers shared by the backend domain (`domains/tasks/*`) and the
 * app (`task-modal.tsx` reads the title limit) — the one home of the task
 * limits and of the sentences that refuse a value over one, so the UI's
 * `maxLength`, the server's validator and the agent's tool signature cannot
 * drift.
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
 * The unit every text limit above counts in. Each cap is checked against a
 * string's `length`, as the board's `maxLength`, the REST schemas and the
 * domain all measure it: UTF-16 code units, where an emoji outside the Basic
 * Multilingual Plane counts as two. A refusal or a tool signature names this
 * unit rather than "characters", which a person or a model counts
 * differently.
 */
const TASK_LIMIT_UNIT = 'UTF-16 code units';

/** A count as a limit sentence prints it: `20000` → `20,000`. */
function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** A cap with its unit, as a signature or a refusal states it:
 * `20,000 UTF-16 code units`. */
export function taskLimitText(max: number): string {
  return `${formatCount(max)} ${TASK_LIMIT_UNIT}`;
}

/*
 * The refusal sentences below name the limit a value broke, its unit and the
 * length measured — never the value itself. Each one is the domain's own
 * sentence for its code, which the app door and the agent's tool result
 * carry beside that code.
 */

function overCapRefusal(subject: string, max: number, length: number): string {
  return (
    `${subject} is capped at ${taskLimitText(max)} (most emoji count as 2); ` +
    `this one has ${formatCount(length)}.`
  );
}

function emptyRefusal(subject: string, max: number): string {
  return `${subject} is empty — it takes 1 to ${taskLimitText(max)}.`;
}

/**
 * Why a task title is refused, or null when it fits. The title is measured
 * trimmed, so a whitespace-only title is an empty one, and an over-long one
 * is told apart from it.
 */
export function taskTitleRefusal(title: string): string | null {
  const length = title.trim().length;
  if (length === 0) return emptyRefusal('The task title', TASK_TITLE_MAX);
  if (length > TASK_TITLE_MAX) {
    return overCapRefusal('The task title', TASK_TITLE_MAX, length);
  }
  return null;
}

/** Why a task description is refused (longer than
 * {@link TASK_DESCRIPTION_MAX} as sent), or null when it fits. */
export function taskDescriptionRefusal(description: string): string | null {
  return description.length > TASK_DESCRIPTION_MAX
    ? overCapRefusal(
        'The task description',
        TASK_DESCRIPTION_MAX,
        description.length,
      )
    : null;
}

/** Why a task's list of labels is refused for its size, or null. */
export function taskLabelCountRefusal(count: number): string | null {
  return count > TASK_LABELS_MAX
    ? `A task carries at most ${formatCount(TASK_LABELS_MAX)} labels; ` +
        `${formatCount(count)} were given.`
    : null;
}

/** Why one label name is refused, or null when it fits. The name is measured
 * as the label catalog stores it: NFC-composed and trimmed. */
export function taskLabelNameRefusal(name: string): string | null {
  const length = name.normalize('NFC').trim().length;
  if (length === 0) return emptyRefusal('A label name', TASK_LABEL_CHARS_MAX);
  if (length > TASK_LABEL_CHARS_MAX) {
    return overCapRefusal('A label name', TASK_LABEL_CHARS_MAX, length);
  }
  return null;
}

/** Why a comment body is refused, or null when it fits. The body is
 * measured trimmed, like the title. */
export function taskCommentRefusal(body: string): string | null {
  const length = body.trim().length;
  if (length === 0) return emptyRefusal('The comment', TASK_COMMENT_MAX);
  if (length > TASK_COMMENT_MAX) {
    return overCapRefusal('The comment', TASK_COMMENT_MAX, length);
  }
  return null;
}

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
