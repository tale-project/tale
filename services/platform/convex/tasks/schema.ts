import { defineTable } from 'convex/server';
import { v } from 'convex/values';

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
 * exactly one actor that is EITHER a human user OR an AI agent. `assigneeType`
 * + `assigneeId` are set/cleared together (invariant enforced in the mutation
 * layer, mirroring the `projects` teamId/projectId mutual-exclusivity style).
 * `assigneeId` is a `string` — not a typed Id — because it polymorphically
 * holds either a Better Auth userId or an agent slug.
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
 * Polymorphic actor type for tasks: a human user or an AI agent. Distinct from
 * the governance `auditLogActorTypeValidator` (which models user/system/api/
 * workflow) — task-domain attribution tracks human-vs-agent authorship.
 */
export const taskActorTypeValidator = v.union(
  v.literal('user'),
  v.literal('agent'),
);

export const tasksTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),

  // Content
  title: v.string(),
  description: v.optional(v.string()),

  // Per-project sequence number claimed at creation from `projects.taskCounter`.
  // Combined with `projects.key` it forms the human-readable id (e.g. `TAL-7`).
  // Optional only for backward-compat with tasks created before numbering.
  number: v.optional(v.number()),

  // Workflow state
  status: taskStatusValidator,
  priority: v.optional(taskPriorityValidator),
  labels: v.optional(v.array(v.string())),

  // Polymorphic single assignee (set/cleared together).
  assigneeType: v.optional(taskActorTypeValidator),
  assigneeId: v.optional(v.string()),

  // Hierarchy (subtasks). Root tasks have parentTaskId undefined.
  parentTaskId: v.optional(v.id('tasks')),

  // Denormalized count of non-deleted comments, maintained by the comment
  // add/delete mutations so the board/table can render a comment indicator
  // without an N+1 fetch. Optional for back-compat with tasks created before
  // counting (treat undefined as 0).
  commentCount: v.optional(v.number()),

  // Board ordering: lexicographic fractional key within (projectId, status).
  rank: v.string(),

  // External linkage for integration sync (e.g. a GitHub issue). All three are
  // set/cleared together by the integration-sync path. `externalId` is a
  // stable, system-scoped natural key (e.g. "owner/repo#123") used to upsert
  // the task idempotently on re-sync — mirroring the `documents.externalItemId`
  // + `sourceProvider` convention. Sync is driven by a file-based automation
  // (examples/default/workflows/github/) through the generic `task` workflow
  // action, NOT by provider-specific backend code.
  externalSystem: v.optional(v.string()),
  externalId: v.optional(v.string()),
  externalUrl: v.optional(v.string()),

  // Authorship + lifecycle
  createdBy: v.string(),
  createdByType: taskActorTypeValidator,
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
  .index('by_org_external', ['organizationId', 'externalSystem', 'externalId'])
  .index('by_org_updatedAt', ['organizationId', 'updatedAt']);

/**
 * Plain-text comments on a task (MVP — no rich text). `mentions` is parsed at
 * write time from `@token` syntax and resolved against the project member/agent
 * directory; unresolved tokens are dropped. `projectId` is denormalized from
 * the task so comment access checks avoid a second task fetch.
 */
export const taskCommentsTable = defineTable({
  organizationId: v.string(),
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  authorType: taskActorTypeValidator,
  authorId: v.string(),
  body: v.string(),
  // Single-level threading: a reply points at the top-level comment it answers.
  // Top-level comments leave this undefined. Replies-to-replies are flattened
  // onto their root thread (the mutation re-roots a nested parent).
  parentCommentId: v.optional(v.id('taskComments')),
  mentions: v.optional(
    v.array(
      v.object({
        type: taskActorTypeValidator,
        id: v.string(),
      }),
    ),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
  editedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_task_createdAt', ['taskId', 'createdAt'])
  .index('by_organization', ['organizationId']);

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
  createdAt: v.number(),
})
  .index('by_task', ['taskId', 'createdAt'])
  .index('by_organization', ['organizationId']);

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
  labels: v.optional(v.array(v.string())),
  assigneeIds: v.optional(v.array(v.string())),
  search: v.optional(v.string()),
});

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
