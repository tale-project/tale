import { v } from 'convex/values';

import { blobRefValidator } from '../lib/storage/blob_ref';

/**
 * Tasks feature schema.
 *
 * A task is a persistent unit of work that lives inside a {@link projectsTable}
 * project and is worked by humans AND AI agents on a shared board. A task's
 * access control is *inherited* from its parent project — see
 * `tasks/access.ts`, which delegates to `projects/access.ts::checkProjectAccess`.
 * There is no task-level ACL.
 *
 * Polymorphic single assignee (locked product decision): a task is assigned to
 * exactly one actor — a human user, an AI agent, or an automation (the
 * ownership signal the task board's status choreography arbitrates on).
 * `assigneeType` + `assigneeId` are set/cleared together (invariant enforced
 * in the mutation layer, mirroring the `projects` teamId/projectId
 * mutual-exclusivity style). `assigneeId` is a `string` — not a typed Id —
 * because it polymorphically holds a Better Auth userId, an agent slug, or an
 * automation store name.
 *
 * Board ordering uses a lexicographic fractional `rank` (LexoRank-style) so a
 * drag-reorder is an O(1) "insert between neighbours" write rather than a
 * whole-column renumber. See `tasks/rank.ts`.
 *
 * Soft-delete via `archivedAt` (mirrors `projects.archivedAt`). Hard delete is
 * admin-only and approval-gated for agents.
 */

export const taskStatusValidator = v.union(
  v.literal('backlog'),
  v.literal('todo'),
  v.literal('in_progress'),
  v.literal('in_review'),
  v.literal('done'),
  v.literal('cancelled'),
);

export const taskPriorityValidator = v.union(
  v.literal('p0'),
  v.literal('p1'),
  v.literal('p2'),
  v.literal('p3'),
);

/**
 * Polymorphic actor type for task ATTRIBUTION — comments, mentions, and
 * activity actors are authored by a human (`user`) or an AI agent (`agent`).
 * Distinct from the governance `auditLogActorTypeValidator` (which models
 * user/system/api/workflow) and from {@link taskAssigneeTypeValidator}, the
 * worker trichotomy.
 */
export const taskActorTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
);

/**
 * What an `@mention` can resolve TO — a superset of the author types above:
 * besides a human or an agent, a comment can mention an AUTOMATION (by store
 * name), which is how the task surface asks the owning automation to run
 * (`triggerMentionedTaskAutomation`). Automations never AUTHOR comments under
 * this type — workflow comments post as `agent` — so authorship keeps the
 * narrower validator.
 */
export const taskMentionTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
  v.literal('automation'),
);

/**
 * The WORKER a task belongs to — exactly one of three classes: a human
 * (`user`), an AI agent (`agent`), or an automation (`app` — `assigneeId`
 * then holds the automation's store name, and the board's status verbs run
 * its workflow).
 */
export const taskAssigneeTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
  v.literal('app'),
);

/**
 * Creator attribution type for a task. Superset of `taskActorTypeValidator`:
 * besides a human (`user`) or an AI agent (`agent`), a task can be provisioned
 * by an installed `app` (e.g. the issue-desk app turning a GitHub issue into a
 * task) — in which case `createdBy` holds the app slug. This is the ownership
 * signal generic task automation arbitrates on: a task with `createdByType:
 * 'app'` is driven by that app's own workflow, so the generic loops bail. Kept
 * the same literals as `taskActorTypeValidator`, but this one records
 * PROVENANCE (who created it) — ownership lives on the assignee. Write-once
 * at creation.
 */
export const taskCreatorTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
  v.literal('app'),
);

/**
 * A single image/document attached to a task. Stored SELF-DESCRIBED (name +
 * MIME + size alongside the storage id) so the board/detail render without a
 * join back to `fileMetadata` — mirroring how chat messages embed their
 * attachments. `fileId` is a blob REFERENCE (a Convex `_storage` id or an
 * `s3:<key>` ref for a BYO-bucket org); the URL is resolved at render time
 * (`getFileUrl`, backend-aware) and the delete cascade routes through
 * `deleteStorageWithMetadata` (also backend-aware). The list is bounded by
 * `TASK_MAX_ATTACHMENTS` and each `fileType` is validated against
 * `TASK_UPLOAD_ALLOWED_TYPES` in the mutation layer (`validateTaskAttachments`).
 */
export const taskAttachmentValidator = v.object({
  fileId: blobRefValidator,
  fileName: v.string(),
  fileType: v.string(),
  fileSize: v.number(),
});

/**
 * One agent-produced deliverable on the task — the harvested `/agent/output`
 * files of the task's agent runs. Self-described like an attachment, plus the
 * run that produced it. Merged by `fileName`: a rerun producing the same name
 * REPLACES the entry (and its blob), so the task always shows the latest
 * deliverable set instead of accumulating stale copies.
 */
export const taskOutputValidator = v.object({
  fileId: blobRefValidator,
  fileName: v.string(),
  fileType: v.string(),
  fileSize: v.number(),
  producedAt: v.number(),
  runId: v.id('projectAgentRuns'),
});

/**
 * The `comment` object embedded in `comment.created` / `comment.mentioned`
 * automation events. Task comments now live in the message store (no
 * `taskComments` doc to attach), so this object is RECONSTRUCTED at emit time.
 * Its shape is load-bearing for the task-ops pack: `react-to-mention-in-task`
 * reads `input.comment.body`, and `comment.*` event filters resolve
 * `comment.projectId` by dot-notation — keep both fields. Typing the
 * reconstruction here fails the build if an emit site drifts from this shape.
 */
export interface CommentEventComment {
  body: string;
  projectId: string;
  taskId: string;
  mentions: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
}

/** Optional workflow attribution on a task-activity row (workflow-engine writes). */
export const taskActivityContextValidator = v.object({
  workflowSlug: v.optional(v.string()),
  wfExecutionId: v.optional(v.id('wfExecutions')),
});

/** Passed into agent internal mutations when the workflow sentinel is the actor. */
export const taskActivityAttributionValidator = v.object({
  workflowSlug: v.optional(v.string()),
  wfExecutionId: v.optional(v.id('wfExecutions')),
});

export const boardViewScopeValidator = v.union(
  v.literal('personal'),
  v.literal('shared'),
);

export const boardViewTypeValidator = v.union(
  v.literal('board'),
  v.literal('table'),
  v.literal('timeline'),
);

export const boardViewFiltersValidator = v.object({
  statuses: v.optional(v.array(taskStatusValidator)),
  priorities: v.optional(v.array(taskPriorityValidator)),
  // Label *names* (not ids) — unused in the live filter UI; kept as strings so
  // saved views stay readable across renames without a dead-code id migration.
  labels: v.optional(v.array(v.string())),
  assigneeIds: v.optional(v.array(v.string())),
  search: v.optional(v.string()),
});

export const projectAgentRunStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('settled'),
  v.literal('failed'),
  v.literal('cancelled'),
);
