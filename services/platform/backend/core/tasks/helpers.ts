/**
 * Pure task helpers shared by the backend domain (`domains/tasks/*`) and the
 * app (`task-modal.tsx` reads the title limit) — the one home of the task
 * limits and of the sentences that refuse a value over one, so the UI's
 * `maxLength`, the server's validator and the agent's tool signature cannot
 * drift.
 * The 0.4 Convex `ctx.db` bodies that used to live here (labels, counters,
 * ranks, activity) have their live twins in `domains/tasks/service.ts`.
 */

import { TASK_DESCRIPTION_MAX } from '@tale/shared/task-limits';
export { TASK_DESCRIPTION_MAX } from '@tale/shared/task-limits';

import { parseIssueNumber, parseRepoRef } from './issue_ref';

export const TASK_TITLE_MAX = 200;
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

/** Grapheme segmentation for the imported cut, built on first use: the app
 * imports this module for its limits, and only an import cuts. */
let graphemes: Intl.Segmenter | undefined;

/**
 * Imported text, trimmed and cut to `max` UTF-16 code units ending in "…".
 * The cut ends on a grapheme boundary (`Intl.Segmenter`), so it never
 * splits what a reader sees as one character: an emoji's surrogate pair (a
 * lone half is no character, and storage writes it as U+FFFD), a ZWJ
 * sequence (a family emoji is kept whole or dropped, never left as its
 * first person), a flag's two regional indicators, a skin-tone modifier, a
 * keycap, or a letter and its combining marks. The last whole grapheme that
 * ends within `max - 1` units is kept; one grapheme longer than that leaves
 * only the "…".
 */
function cutImportedText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  // The grapheme holding unit `max - 1`, the first with no room left beside
  // the "…", starts where the kept text ends: at that unit when it opens a
  // grapheme, before it when it continues one. (`containing` answers
  // undefined only past the end, and `trimmed` is longer than `max`.)
  const end = graphemes.segment(trimmed).containing(max - 1)?.index ?? 0;
  return `${trimmed.slice(0, end).trimEnd()}…`;
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
  return cutImportedText(title, TASK_TITLE_MAX);
}

/**
 * Coerce an externally-sourced task description (an issue body, a ticket's
 * text) to fit `TASK_DESCRIPTION_MAX`, the way {@link truncateImportedTitle}
 * fits a title. Nobody at the import site wrote it (a GitHub issue body runs
 * to 65,536), and refusing it would fail the whole item: its create and
 * every later reconcile. Storing it whole would leave a description no other
 * door could write, which the board's own edit then refuses. A door where
 * the caller writes the text (the board, `task_create`, the REST intake)
 * refuses a longer one by name instead. The full text stays reachable via
 * `externalUrl`. Returns an empty string for a blank description.
 */
export function truncateImportedDescription(description: string): string {
  return cutImportedText(description, TASK_DESCRIPTION_MAX);
}

/**
 * Why an imported title is refused, or null. Its length never is: an
 * over-long one is cut ({@link truncateImportedTitle}). A blank one names
 * nothing, and is refused with the empty-title sentence every door answers.
 */
export function importedTaskTitleRefusal(title: string): string | null {
  return title.trim() === ''
    ? emptyRefusal('The task title', TASK_TITLE_MAX)
    : null;
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
