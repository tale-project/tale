import { defineTable } from 'convex/server';
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
 * One agent-produced deliverable on the task — the harvested `/user/output`
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

export const tasksTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),

  // Content
  title: v.string(),
  description: v.optional(v.string()),

  // Image/document attachments (images + documents only — no audio/video).
  // Self-described so the UI renders without a fileMetadata join; full-replaced
  // by createTask/updateTask like `labels`. Bounded by TASK_MAX_ATTACHMENTS.
  attachments: v.optional(v.array(taskAttachmentValidator)),

  // Agent-run deliverables (harvested `/user/output`), merged by fileName —
  // written only by the task-agent settle, never by the client.
  outputs: v.optional(v.array(taskOutputValidator)),

  // Per-project sequence number claimed at creation from `projects.taskCounter`.
  // Combined with `projects.key` it forms the human-readable id (e.g. `TAL-7`).
  // Optional only for backward-compat with tasks created before numbering.
  number: v.optional(v.number()),

  // Workflow state
  status: taskStatusValidator,
  priority: v.optional(taskPriorityValidator),
  // Project-scoped catalog refs (see taskLabelsTable). Resolved to
  // `{ id, name, color }` on read. Writers still pass label *names*, which
  // `resolveProjectLabels` maps to ids: human paths reject a name the project
  // catalog doesn't hold (create it in the manage dialog first), agent /
  // external-sync paths create it on the fly.
  labelIds: v.optional(v.array(v.id('taskLabels'))),
  /**
   * DEPRECATED — freeform string labels. Cleared by the task-labels
   * migration after minting `taskLabels` rows + `labelIds`. Kept optional so
   * mid-migration documents still validate.
   */
  labels: v.optional(v.array(v.string())),

  // Polymorphic single assignee (set/cleared together).
  assigneeType: v.optional(taskAssigneeTypeValidator),
  assigneeId: v.optional(v.string()),

  // Named human REVIEWER (soft designation): the person agent/automation work
  // waits on when it parks at `in_review` — drives notify + the "Needs my
  // review" queue, NOT an exclusive ACL (any project editor can still
  // respond). Holds EXPLICIT designation only (a Better Auth userId, same ref
  // style as `createdBy`); defaults are derived at need by `resolveReviewer`
  // and never persisted. Deliberately separate from the assignee: designating
  // a reviewer must never take over the driving agent/automation.
  reviewerUserId: v.optional(v.string()),

  // Hierarchy (subtasks). Root tasks have parentTaskId undefined.
  parentTaskId: v.optional(v.id('tasks')),

  // Denormalized count of non-deleted comments, maintained by the comment
  // add/delete mutations so the board/table can render a comment indicator
  // without an N+1 fetch. Optional for back-compat with tasks created before
  // counting (treat undefined as 0).
  commentCount: v.optional(v.number()),

  // Board ordering: lexicographic fractional key within (projectId, status).
  rank: v.string(),

  // External linkage for connector sync (e.g. a GitHub issue). All three are
  // set/cleared together by the connector-sync path. `externalId` is a
  // stable, system-scoped natural key (e.g. "owner/repo#123") used to upsert
  // the task idempotently on re-sync — mirroring the `documents.externalItemId`
  // + `sourceProvider` convention. Sync is driven by a file-based automation
  // (configs/platform/custom/automations/github/) through the generic `task` workflow
  // action, NOT by provider-specific backend code.
  externalSystem: v.optional(v.string()),
  externalId: v.optional(v.string()),
  externalUrl: v.optional(v.string()),

  // Planned start (ms since epoch, local midnight). Optional schedule bound;
  // drives the start-reached date-notification sweep.
  startDate: v.optional(v.number()),

  // One-shot stamp for the start-reached notification. Set atomically by
  // `sweepStartingTasks` so the cron notifies exactly once per start date.
  // Cleared when `startDate` is cleared or moved.
  startNotifiedAt: v.optional(v.number()),

  // Deadline (ms since epoch). Drives overdue badges and the SLA-enforcement
  // / date-notification sweeps.
  dueDate: v.optional(v.number()),

  // SLA escalation ladder state, stamped atomically by the due-soon /
  // overdue mark-and-return mutations so each level fires at most once per
  // task: 1 = due-soon warned, 2 = overdue nudged, 3 = manager-escalated,
  // 4 = owner/admin-escalated. Cleared when `dueDate` moves into the future.
  slaLevel: v.optional(v.number()),
  slaLevelAt: v.optional(v.number()),

  // When the task last changed status. Powers age-in-column board chips and
  // stale-work detection without an N+1 over taskActivity. Stamped by every
  // status-writing mutation; legacy rows fall back to `updatedAt`.
  statusChangedAt: v.optional(v.number()),

  // Per-task circuit breaker (agent guardrails): set when automated agent
  // runs on this task exceeded the org's runs-per-hour cap. Cleared when a
  // HUMAN changes the task status. While set, all automated runs are refused.
  agentRunsPausedAt: v.optional(v.number()),
  agentRunsPausedReason: v.optional(v.string()),

  // Agent-work denormalizations maintained by `task_metrics` internal
  // mutations (start/record/finalize of taskAgentRuns). Treat undefined as 0.
  totalCostCents: v.optional(v.number()),
  agentRunCount: v.optional(v.number()),
  lastAgentRunAt: v.optional(v.number()),

  // Dedicated agent working thread for this task (created lazily on the first
  // agent run). Revision/mention runs share it so context accumulates.
  threadId: v.optional(v.string()),

  // The task's UNIFIED comment surface: a `kind:'task_discussion'` chat thread
  // (created lazily on the first comment) whose messages ARE the task comments.
  // DISTINCT from `threadId` (the private agent working/run context — reusing it
  // would leak run prompts into the visible discussion) and from
  // `sourceDiscussionThreadId` (the createTaskFromDiscussion spawn backlink).
  discussionThreadId: v.optional(v.string()),

  // Historical: the retired project-discussions surface could spawn a task
  // from a discussion; rows created back then keep the backlink even though
  // the source threads are purged. Never written anymore.
  sourceDiscussionThreadId: v.optional(v.string()),

  // Authorship + lifecycle
  createdBy: v.string(),
  createdByType: taskCreatorTypeValidator,
  claimedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})
  .index('by_organization', ['organizationId'])
  .index('by_project', ['projectId'])
  .index('by_project_status_rank', ['projectId', 'status', 'rank'])
  .index('by_project_archived', ['projectId', 'archivedAt'])
  .index('by_assignee', ['organizationId', 'assigneeType', 'assigneeId'])
  .index('by_parent', ['parentTaskId'])
  // External-ref dedup keyed at two scopes (see `agentUpsertTaskByExternalRef`):
  // `by_org_external` for org-scoped materialization (one task per issue per org);
  // `by_project_external` for project-scoped apps (one task per issue per project,
  // so the same issue worked in two projects yields two independent tasks).
  .index('by_org_external', ['organizationId', 'externalSystem', 'externalId'])
  .index('by_project_external', ['projectId', 'externalSystem', 'externalId'])
  .index('by_org_updatedAt', ['organizationId', 'updatedAt'])
  // Reviewer designations by user (GDPR erasure sweep; reviewer-queue scans).
  .index('by_org_reviewer', ['organizationId', 'reviewerUserId'])
  // Due-soon / overdue sweeps (SLA / date-notification enforcement).
  .index('by_org_dueDate', ['organizationId', 'dueDate'])
  // Start-reached date-notification sweep.
  .index('by_org_startDate', ['organizationId', 'startDate'])
  // Stale / archivable sweeps.
  .index('by_org_status', ['organizationId', 'status']);

/**
 * Mutable side-car for the unified task-discussion comment surface. Task
 * comments are stored as messages in a `kind:'task_discussion'` thread (the
 * `@convex-dev/agent` message store), but that store has no author field, no
 * `editedAt`, no queryable `mentions`, and immutable metadata — so the bits a
 * task comment needs beyond raw text live here, keyed by `messageId` and
 * written in LOCKSTEP with every message (see `postTaskDiscussionMessage`). One
 * row per visible comment; the row is deleted when the message is hard-deleted.
 */
export const taskDiscussionMessageMetaTable = defineTable({
  organizationId: v.string(),
  // The `kind:'task_discussion'` thread the message lives in (= tasks.discussionThreadId).
  threadId: v.string(),
  taskId: v.id('tasks'),
  // The `@convex-dev/agent` message id (opaque string; not a Convex doc id).
  messageId: v.string(),
  // Human-vs-agent authorship. Workflow-authored comments are stored as `agent`
  // (the validator has no `workflow` literal); the workflow-vs-agent distinction
  // survives only in emitted `eventData` via `eventActor(actorId)`, exactly as
  // the legacy taskComments path behaved.
  authorType: taskActorTypeValidator,
  authorId: v.string(),
  // Parsed at write time from `@token` syntax and re-parsed on edit — the agent
  // prompt context and the `react-to-mention-in-task` loop guard read this.
  mentions: v.optional(
    v.array(
      v.object({
        type: taskActorTypeValidator,
        id: v.string(),
      }),
    ),
  ),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
  // Optional write-time locale snapshot for workflow-authored comments
  // (`task.comment` with `bodyI18n`). Canonical English stays in the message
  // store `body` (and drives `afterMarker` / mention parsing); the UI picks
  // `bodyByLocale[viewerLocale] ?? body`. Absent on human / single-body posts.
  bodyByLocale: v.optional(
    v.object({
      en: v.string(),
      de: v.string(),
      fr: v.string(),
    }),
  ),
})
  .index('by_messageId', ['messageId'])
  .index('by_task', ['taskId', 'createdAt']);

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
  mentions: Array<{ type: 'user' | 'agent'; id: string }>;
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

/**
 * Append-only per-task activity timeline (status/assignee/etc. changes). This
 * is the product-facing "Activity" tab feed and is intentionally distinct from
 * the org-wide governance `auditLogs` table (which is the compliance trail).
 * The creation row uses `action: 'created'` with `fromValue` undefined.
 */
export const taskActivityTable = defineTable({
  organizationId: v.string(),
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  actorType: taskActorTypeValidator,
  actorId: v.string(),
  action: v.string(),
  fromValue: v.optional(v.string()),
  toValue: v.optional(v.string()),
  /** Workflow that drove this row when `actorId` is the workflow sentinel. */
  context: v.optional(taskActivityContextValidator),
  createdAt: v.number(),
})
  .index('by_task', ['taskId', 'createdAt'])
  .index('by_organization', ['organizationId'])
  // Day-windowed scans for the daily task-metrics rollup cron.
  .index('by_org_createdAt', ['organizationId', 'createdAt']);

/**
 * Directed "blocked by" dependency edge between two tasks in the SAME project.
 * An edge `blockerTaskId → blockedTaskId` reads as "the blocker must finish
 * before the blocked task can proceed". The relationship is advisory (soft):
 * the board surfaces a "blocked" indicator while a blocker is unfinished, but a
 * status change is never refused — unlike the hard parent-close guard for
 * subtasks. Cycles are rejected at write time (see `tasks/dependencies.ts`), so
 * the edge set stays a DAG. Both endpoints live in one project — there is no
 * cross-project dependency, mirroring the same-project `parentTaskId` rule.
 */
export const taskDependenciesTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  blockerTaskId: v.id('tasks'),
  blockedTaskId: v.id('tasks'),
  createdBy: v.string(),
  createdByType: taskActorTypeValidator,
  createdAt: v.number(),
})
  .index('by_blocker', ['blockerTaskId'])
  .index('by_blocked', ['blockedTaskId'])
  .index('by_project', ['projectId'])
  .index('by_edge', ['blockerTaskId', 'blockedTaskId']);

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

/**
 * Project-scoped task label catalog. One row per normalized name per project.
 * Tasks reference rows via `tasks.labelIds`; colour lives here (replaces the
 * retired `projects.taskLabelColors` sidecar). Create-on-assign upserts a row
 * when a writer passes a new name — there is no separate labels admin surface.
 */
export const taskLabelsTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  /** Normalized lowercase name; unique per project via `by_project_name`. */
  name: v.string(),
  /** Palette name derived from `name` on write; readers re-derive via
   *  `defaultTaskLabelColor` so colour stays automatic. */
  color: v.string(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_project', ['projectId'])
  .index('by_project_name', ['projectId', 'name'])
  .index('by_organization', ['organizationId']);

/**
 * Saved board/table/timeline view for a project: a named bundle of grouping +
 * filters + sort. `scope` 'shared' is visible to all project members; 'personal'
 * to its owner only. The ACTIVE view-type toggle (Board|Table|Timeline) is
 * ephemeral client state (`usePersistedState`), NOT a row here.
 */
export const boardViewsTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  ownerId: v.string(),
  name: v.string(),
  scope: boardViewScopeValidator,
  viewType: boardViewTypeValidator,
  filters: boardViewFiltersValidator,
  sort: v.optional(v.object({ field: v.string(), desc: v.boolean() })),
  isDefault: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_project', ['projectId'])
  .index('by_project_owner', ['projectId', 'ownerId']);

export const projectAgentRunStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('settled'),
  v.literal('failed'),
  v.literal('cancelled'),
);

/**
 * One run of a project agent against one task — the task-side twin of an
 * automation run. Kicked when an agent-owned task moves to `in_progress`
 * (or Retry / request-changes re-kicks); driven by
 * `tasks/agent_run_host.ts`; settled exactly once. Success posts the result
 * as an agent task comment and parks the task at `in_review` (agents never
 * complete work). Failure keeps the task at `in_progress` — a failed run is
 * the RUN's state, not the task's; the run card offers Retry.
 *
 * The sandbox session is the agent's STANDING one
 * (`sessionIdForProjectAgent`) — the workspace persists across runs, so an
 * agent keeps its working state between assignments.
 */
export const projectAgentRunsTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  taskId: v.id('tasks'),
  agentId: v.id('projectAgents'),
  execId: v.string(),
  sessionId: v.string(),
  status: projectAgentRunStatusValidator,
  harness: v.string(),
  model: v.string(),
  error: v.optional(v.string()),
  resultText: v.optional(v.string()),
  /** The settled result's task-comment message id (success only). */
  resultMessageId: v.optional(v.string()),
  /** What kicked the run: the explicit verb / board drag (default) or a
   * comment @mention of the agent. */
  trigger: v.optional(v.union(v.literal('manual'), v.literal('mention'))),
  /** Reviewer feedback carried into the turn's brief — the body of the
   * @mention comment that kicked this run. */
  feedback: v.optional(v.string()),
  /** Set while the run is PARKED on sandbox capacity: the org's session
   * budget was full when the start tried to reserve a slot. The run stays
   * `queued`; a slot release (or the watchdog backstop) claims the stamp —
   * clearing it IS the single-winner claim — and retries the start. Without
   * the stamp a queued run is a start in flight, and the watchdog's
   * staleness window applies to it. */
  waitingForCapacityAt: v.optional(v.number()),
  startedBy: v.string(),
  startedAt: v.number(),
  deadlineAt: v.number(),
  settledAt: v.optional(v.number()),
  updatedAt: v.number(),
})
  .index('by_task', ['taskId'])
  .index('by_agent', ['agentId'])
  .index('by_status', ['status'])
  // The capacity wake scans one org's queued runs oldest-first — `by_status`
  // alone would walk every org's queue on each release edge.
  .index('by_org_status', ['organizationId', 'status']);
