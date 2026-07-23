/**
 * Tasks feature queries (read side).
 *
 * Every query loads the parent project once and gates the whole result on
 * `checkProjectAccess` — a task inherits its project's ACL. Board reads are
 * capped per project (`TASK_BOARD_CAP`) with a `truncated` flag, mirroring the
 * `getProjectStats` bounded-scan pattern; the M1 board groups by status +
 * orders by `rank` client-side.
 */

import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { isActiveDocument } from '../documents/_helpers';
import { readPolicyConfig } from '../governance/helpers';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import { assertActiveOrg } from '../lib/rls/organization/assert_active_org';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { toId } from '../lib/type_cast_helpers';
import { canClaimTask, checkProjectAccess } from './access';
import { readTaskDiscussionMessages } from './internal_queries';
import { listTasksByProjectPaginated as listTasksByProjectPaginatedHelper } from './list_tasks_paginated';
import { collectPendingReviewsByTask } from './pending_reviews';
import {
  boardViewFiltersValidator,
  boardViewScopeValidator,
  boardViewTypeValidator,
  taskActorTypeValidator,
  taskAttachmentValidator,
  taskCreatorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

export const TASK_BOARD_CAP = 2000;
const TASK_ACTIVITY_CAP = 500;
const WORKFLOW_CONTEXT_WINDOW_MS = 5 * 60 * 1000;

function executionWorkflowSlug(exec: Doc<'wfExecutions'>): string | undefined {
  return (
    exec.workflowSlug ??
    (typeof exec.wfDefinitionId === 'string' ? exec.wfDefinitionId : undefined)
  );
}

function nearestByTimestamp<T extends { startedAt: number }>(
  at: number,
  items: T[],
  windowMs: number,
): T | undefined {
  let best: T | undefined;
  let bestDelta = Infinity;
  for (const item of items) {
    const delta = Math.abs(item.startedAt - at);
    if (delta > windowMs || delta >= bestDelta) continue;
    bestDelta = delta;
    best = item;
  }
  return best;
}

/** Backfill workflow slug/execution on workflow-sentinel activity rows. */
async function enrichWorkflowActivityRows(
  ctx: QueryCtx,
  organizationId: string,
  taskId: Id<'tasks'>,
  rows: Doc<'taskActivity'>[],
): Promise<Doc<'taskActivity'>[]> {
  // Only pay for the backfill scans when a workflow row is missing its slug —
  // go-forward rows store `context.workflowSlug` at write time.
  if (
    !rows.some(
      (row) => row.actorId === 'workflow' && !row.context?.workflowSlug,
    )
  ) {
    return rows;
  }

  const executionById = new Map<Id<'wfExecutions'>, Doc<'wfExecutions'>>();
  for (const row of rows) {
    const executionId = row.context?.wfExecutionId;
    if (!executionId || executionById.has(executionId)) continue;
    const exec = await ctx.db.get(executionId);
    if (exec) executionById.set(executionId, exec);
  }

  // `.take()` returns a Promise<Doc[]>, not an async iterator — await it
  // directly (a `for await` over it throws at runtime).
  const agentRuns: Doc<'taskAgentRuns'>[] = await ctx.db
    .query('taskAgentRuns')
    .withIndex('by_task_started', (q) => q.eq('taskId', taskId))
    .order('desc')
    .take(20);

  const executions: Doc<'wfExecutions'>[] = [];
  for await (const exec of ctx.db
    .query('wfExecutions')
    .withIndex('by_org_subject', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('subjectType', 'task')
        .eq('subjectId', String(taskId)),
    )
    .order('desc')) {
    executions.push(exec);
    if (executions.length >= 30) break;
  }

  return rows.map((row) => {
    if (row.actorId !== 'workflow') return row;

    let workflowSlug = row.context?.workflowSlug;
    let wfExecutionId = row.context?.wfExecutionId;

    if (!workflowSlug && wfExecutionId) {
      const exec = executionById.get(wfExecutionId);
      workflowSlug = exec ? executionWorkflowSlug(exec) : workflowSlug;
    }

    if (!workflowSlug) {
      const run = nearestByTimestamp(
        row.createdAt,
        agentRuns,
        WORKFLOW_CONTEXT_WINDOW_MS,
      );
      if (run?.workflowSlug) {
        workflowSlug = run.workflowSlug;
        wfExecutionId = wfExecutionId ?? run.wfExecutionId;
      }
    }

    if (!workflowSlug) {
      const exec = nearestByTimestamp(
        row.createdAt,
        executions,
        WORKFLOW_CONTEXT_WINDOW_MS,
      );
      if (exec) {
        workflowSlug = executionWorkflowSlug(exec);
        wfExecutionId = wfExecutionId ?? exec._id;
      }
    }

    if (
      workflowSlug === row.context?.workflowSlug &&
      wfExecutionId === row.context?.wfExecutionId
    ) {
      return row;
    }

    return {
      ...row,
      context: {
        workflowSlug,
        wfExecutionId,
      },
    };
  });
}

async function getAuthContext(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ userId: string; role: string; teamIds: string[] }> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Unauthenticated',
    });
  }
  const member = await getOrganizationMember(ctx, organizationId, authUser);
  const teamIds = await getUserTeamIds(ctx, member.userId);
  return { userId: member.userId, role: member.role, teamIds };
}

export async function loadAccessibleProject(
  ctx: QueryCtx,
  projectId: Id<'projects'>,
  activeOrgId: string,
): Promise<{
  project: Doc<'projects'>;
  auth: { userId: string; role: string; teamIds: string[] };
  canEdit: boolean;
}> {
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new ConvexError({
      code: 'PROJECT_NOT_FOUND',
      message: 'PROJECT_NOT_FOUND',
    });
  }
  // Active-org coherence: the task/project must belong to the caller's ACTIVE
  // org, not merely an org they are a member of — otherwise a carried-over
  // cross-org id resolves to another org's tasks. See assert_active_org.
  assertActiveOrg(project.organizationId, activeOrgId);
  const auth = await getAuthContext(ctx, project.organizationId);
  const access = checkProjectAccess(project, auth.teamIds, auth.role);
  if (!access.canRead) {
    throw new ConvexError({
      code: 'TASK_FORBIDDEN',
      message: 'TASK_FORBIDDEN',
    });
  }
  return { project, auth, canEdit: access.canEdit };
}

export const taskRowValidator = v.object({
  _id: v.id('tasks'),
  _creationTime: v.number(),
  organizationId: v.string(),
  projectId: v.id('projects'),
  title: v.string(),
  description: v.optional(v.string()),
  attachments: v.optional(v.array(taskAttachmentValidator)),
  number: v.optional(v.number()),
  status: taskStatusValidator,
  priority: v.optional(taskPriorityValidator),
  labels: v.optional(v.array(v.string())),
  assigneeType: v.optional(taskActorTypeValidator),
  assigneeId: v.optional(v.string()),
  parentTaskId: v.optional(v.id('tasks')),
  commentCount: v.optional(v.number()),
  rank: v.string(),
  externalSystem: v.optional(v.string()),
  externalId: v.optional(v.string()),
  externalUrl: v.optional(v.string()),
  dueDate: v.optional(v.number()),
  slaLevel: v.optional(v.number()),
  slaLevelAt: v.optional(v.number()),
  statusChangedAt: v.optional(v.number()),
  agentRunsPausedAt: v.optional(v.number()),
  agentRunsPausedReason: v.optional(v.string()),
  totalCostCents: v.optional(v.number()),
  agentRunCount: v.optional(v.number()),
  lastAgentRunAt: v.optional(v.number()),
  threadId: v.optional(v.string()),
  discussionThreadId: v.optional(v.string()),
  sourceDiscussionThreadId: v.optional(v.string()),
  createdBy: v.string(),
  createdByType: taskCreatorTypeValidator,
  claimedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
});

/** A task comment in the unified model: a `task_discussion` message joined
 *  with its side-car meta. `messageId` is the agent message-store id (string),
 *  `editedAt`/`mentions` pre-joined so the UI never does a render-time lookup. */
const taskDiscussionMessageValidator = v.object({
  messageId: v.string(),
  authorType: taskActorTypeValidator,
  authorId: v.string(),
  body: v.string(),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
  mentions: v.optional(
    v.array(v.object({ type: taskActorTypeValidator, id: v.string() })),
  ),
  bodyByLocale: v.optional(
    v.object({
      en: v.string(),
      de: v.string(),
      fr: v.string(),
    }),
  ),
});

const activityRowValidator = v.object({
  _id: v.id('taskActivity'),
  _creationTime: v.number(),
  organizationId: v.string(),
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  actorType: taskActorTypeValidator,
  actorId: v.string(),
  action: v.string(),
  fromValue: v.optional(v.string()),
  toValue: v.optional(v.string()),
  context: v.optional(
    v.object({
      workflowSlug: v.optional(v.string()),
      wfExecutionId: v.optional(v.id('wfExecutions')),
    }),
  ),
  createdAt: v.number(),
});

/**
 * List all non-archived tasks for a project the caller can read.
 * Returns rows ordered by (status, rank) plus a `truncated` flag when the
 * project exceeds {@link TASK_BOARD_CAP}.
 */
export const listTasksByProject = query({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    includeArchived: v.optional(v.boolean()),
    status: v.optional(taskStatusValidator),
    // Multi-status scope: only tasks whose status is IN this set. The Board and
    // List pass every board status (including `backlog`) — one query, all lanes.
    // server-side instead of client filtering. Omitted ⇒ all statuses.
    statuses: v.optional(v.array(taskStatusValidator)),
    assigneeId: v.optional(v.string()),
    // Scope to tasks linked to an external system (e.g. 'github') — lets an
    // app surface (the issue-desk Tasks tab) show only the tasks IT derived
    // from issues, not the whole project board. Omitted ⇒ all tasks.
    externalSystem: v.optional(v.string()),
  },
  returns: v.object({
    tasks: v.array(taskRowValidator),
    truncated: v.boolean(),
    // Whether the caller may write to this project. The board/list use it to
    // hide or disable write controls (Create, the priority/assignee pickers,
    // drag-reorder) for read-only viewers — the server still rejects any
    // unauthorized write, so this is purely a UX/consistency affordance.
    canEdit: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { project, canEdit } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );

    const rows: Doc<'tasks'>[] = [];
    let truncated = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))) {
      if (!args.includeArchived && task.archivedAt) continue;
      if (args.status && task.status !== args.status) continue;
      if (args.statuses && !args.statuses.includes(task.status)) continue;
      if (args.assigneeId && task.assigneeId !== args.assigneeId) continue;
      if (args.externalSystem && task.externalSystem !== args.externalSystem)
        continue;
      rows.push(task);
      if (rows.length >= TASK_BOARD_CAP) {
        truncated = true;
        break;
      }
    }

    rows.sort((a, b) =>
      a.status === b.status
        ? a.rank.localeCompare(b.rank)
        : a.status.localeCompare(b.status),
    );

    return { tasks: rows, truncated, canEdit };
  },
});

/**
 * Cursor-paginated sibling of {@link listTasksByProject} for the config-driven
 * `Collection` block. Walks `by_project_status_rank` so rows arrive in
 * `(status, rank)` order — the board grouping — preserved across pages, with the
 * facets applied as `.filter()` (see `list_tasks_paginated`). Project-ACL gated
 * exactly like the bounded list; `returns` is omitted (the paginated-query
 * convention, mirroring `customers`/`products`).
 */
export const listTasksByProjectPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    projectId: v.id('projects'),
    organizationId: v.string(),
    externalSystem: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { project } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );
    const result = await listTasksByProjectPaginatedHelper(ctx, args);
    // Stamp each row with its review-gate state so row-driven view actions can
    // gate on it (`when: "pendingReview"`) — one bounded scan per page, shared
    // with the board's ops indicators.
    const pendingByTask = await collectPendingReviewsByTask(
      ctx,
      project.organizationId,
      args.projectId,
    );
    // Stamp, per the task's external FOLDER, two signals a folder-driven view
    // gates row actions on: `folderExists` (the bound folder is still there —
    // a deleted quarter leaves an orphaned return the desk marks and lets you
    // remove) and `hasFiles` (it holds ≥1 active file — hide Start until
    // documents are uploaded). One `.get` + one bounded `.take` per DISTINCT
    // folder, deduped across the page.
    const foldersWithFiles = new Set<string>();
    const existingFolders = new Set<string>();
    const checkedFolders = new Set<string>();
    for (const task of result.page) {
      const folderId = task.externalId;
      if (folderId === undefined || checkedFolders.has(folderId)) continue;
      checkedFolders.add(folderId);
      const folder = await ctx.db.get(toId<'folders'>(folderId));
      if (
        !folder ||
        folder.organizationId !== project.organizationId ||
        folder.projectId !== args.projectId
      ) {
        continue; // orphaned: folder deleted or not in this project.
      }
      existingFolders.add(folderId);
      // A small bounded page is enough to answer "any active file?" — quarter
      // folders hold at most a handful; a trashed doc must not count, so the
      // active check runs in JS (`lifecycleStatus`), not a fragile arg-filter.
      const docs = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_folderId', (q) =>
          q
            .eq('organizationId', project.organizationId)
            .eq('folderId', toId<'folders'>(folderId)),
        )
        .take(50);
      if (docs.some(isActiveDocument)) foldersWithFiles.add(folderId);
    }
    return {
      ...result,
      page: result.page.map((task) =>
        Object.assign(task, {
          pendingReview: pendingByTask.has(String(task._id)),
          // A task with no external folder (non-folder-driven) is not an
          // orphan — folderExists only means false when it HAD a folder that
          // is now gone. Default true so non-desk task lists are unaffected.
          folderExists:
            task.externalId === undefined ||
            existingFolders.has(task.externalId),
          hasFiles:
            task.externalId !== undefined &&
            foldersWithFiles.has(task.externalId),
        }),
      ),
    };
  },
});

/**
 * The set of `externalId` keys already materialized into this project's tasks for
 * one external system (e.g. every GitHub issue that's already a task). Powers the
 * issue desk's "hide issues already tracked" cross-reference — both the server's
 * filtered-pagination anti-join AND the client's live top-up read it.
 *
 * Deliberately UN-truncated (unlike `listTasksByProject`'s `TASK_BOARD_CAP`): an
 * incomplete exclusion set silently leaks already-tracked issues back into the
 * list, so correctness requires the WHOLE set. The read is index-narrowed to
 * `(projectId, externalSystem)` and returns bare keys (not whole task rows), so
 * it stays cheap even for large projects.
 */
export const listExternalKeysByProject = query({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    externalSystem: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const { project } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );

    const keys: string[] = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project_external', (q) =>
        q
          .eq('projectId', project._id)
          .eq('externalSystem', args.externalSystem),
      )) {
      if (task.externalId) keys.push(task.externalId);
    }
    return keys;
  },
});

/**
 * Org-wide task list (reactive) — the `task_collection` data source for the Apps
 * hub. Unlike `listTasksByProject`, a config-driven app can't know a projectId,
 * so this lists the org's recent tasks filtered by externalSystem/status (e.g.
 * GitHub issues). Org-membership gated; returns empty on no auth.
 */
export const listTasksByOrg = query({
  args: {
    organizationId: v.string(),
    externalSystem: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    tasks: v.array(taskRowValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return { tasks: [], truncated: false };
    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return { tasks: [], truncated: false };
      }
      throw error;
    }

    const limit = Math.min(args.limit ?? 100, 500);
    const rows: Doc<'tasks'>[] = [];
    let truncated = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_updatedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      if (task.archivedAt) continue;
      if (args.externalSystem && task.externalSystem !== args.externalSystem) {
        continue;
      }
      if (args.status && task.status !== args.status) continue;
      rows.push(task);
      if (rows.length >= limit) {
        truncated = true;
        break;
      }
    }
    return { tasks: rows, truncated };
  },
});

/** Fetch a single task with the caller's edit/claim/comment affordances. */
export const getTask = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      task: taskRowValidator,
      canEdit: v.boolean(),
      canClaim: v.boolean(),
      // Whether the caller may post/comment on the task's discussion. Commenting
      // is a READ-level action (any org member who can read the task, mirroring
      // a project discussion reply — see `addTaskComment`), so it's true for
      // read-only members who cannot otherwise edit the task (#2339). The modal
      // gates the comment composer off this rather than `canEdit`.
      canComment: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const { canEdit } = await loadAccessibleProject(
      ctx,
      task.projectId,
      args.organizationId,
    );
    // Reaching here means the caller passed the read gate in
    // `loadAccessibleProject`, which is exactly the requirement to comment.
    return {
      task,
      canEdit,
      canClaim: canEdit && canClaimTask(task),
      canComment: true,
    };
  },
});

/** List direct subtasks of a task. */
export const listSubtasks = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.array(taskRowValidator),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.taskId);
    if (!parent) return [];
    await loadAccessibleProject(ctx, parent.projectId, args.organizationId);
    const children: Doc<'tasks'>[] = [];
    for await (const child of ctx.db
      .query('tasks')
      .withIndex('by_parent', (q) => q.eq('parentTaskId', args.taskId))) {
      children.push(child);
    }
    children.sort((a, b) => a.rank.localeCompare(b.rank));
    return children;
  },
});

/**
 * Both sides of a task's dependency graph: `blockedBy` are the tasks that must
 * finish before this one, `blocks` are the tasks waiting on this one. Each side
 * returns the full linked task rows (callers render status/title and navigate
 * into them). Edges whose linked task no longer exists are skipped.
 */
export const listTaskDependencies = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.object({
    blockedBy: v.array(taskRowValidator),
    blocks: v.array(taskRowValidator),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { blockedBy: [], blocks: [] };
    await loadAccessibleProject(ctx, task.projectId, args.organizationId);

    const blockedBy: Doc<'tasks'>[] = [];
    for await (const edge of ctx.db
      .query('taskDependencies')
      .withIndex('by_blocked', (q) => q.eq('blockedTaskId', args.taskId))) {
      const blocker = await ctx.db.get(edge.blockerTaskId);
      if (blocker) blockedBy.push(blocker);
    }

    const blocks: Doc<'tasks'>[] = [];
    for await (const edge of ctx.db
      .query('taskDependencies')
      .withIndex('by_blocker', (q) => q.eq('blockerTaskId', args.taskId))) {
      const dependent = await ctx.db.get(edge.blockedTaskId);
      if (dependent) blocks.push(dependent);
    }

    return { blockedBy, blocks };
  },
});

/**
 * Every dependency edge in a project (bounded), so the board/list/table can
 * derive which tasks are currently blocked from the task set already loaded.
 */
export const listProjectDependencies = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.array(
    v.object({
      blockerTaskId: v.id('tasks'),
      blockedTaskId: v.id('tasks'),
    }),
  ),
  handler: async (ctx, args) => {
    await loadAccessibleProject(ctx, args.projectId, args.organizationId);
    const edges: { blockerTaskId: Id<'tasks'>; blockedTaskId: Id<'tasks'> }[] =
      [];
    for await (const edge of ctx.db
      .query('taskDependencies')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))) {
      edges.push({
        blockerTaskId: edge.blockerTaskId,
        blockedTaskId: edge.blockedTaskId,
      });
      if (edges.length >= TASK_BOARD_CAP) break;
    }
    return edges;
  },
});

/**
 * A task's comment surface (unified model): the lazily-created
 * `task_discussion` thread id (null when the task has no comments yet) plus its
 * messages (oldest first), each pre-joined with author/editedAt/mentions. The
 * null-thread case is the threadless-task bootstrap the modal renders as an
 * empty state. Project-access gated like every task read.
 */
export const getTaskDiscussion = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.object({
    threadId: v.union(v.string(), v.null()),
    messages: v.array(taskDiscussionMessageValidator),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { threadId: null, messages: [] };
    await loadAccessibleProject(ctx, task.projectId, args.organizationId);
    const messages = await readTaskDiscussionMessages(ctx, task);
    return { threadId: task.discussionThreadId ?? null, messages };
  },
});

const boardViewRowValidator = v.object({
  _id: v.id('boardViews'),
  _creationTime: v.number(),
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
});

/** List saved board views for a project: all shared views + the caller's own personal views. */
export const listBoardViews = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.array(boardViewRowValidator),
  handler: async (ctx, args) => {
    const { auth } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );
    const views: Doc<'boardViews'>[] = [];
    for await (const view of ctx.db
      .query('boardViews')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))) {
      if (view.scope === 'shared' || view.ownerId === auth.userId) {
        views.push(view);
      }
    }
    return views;
  },
});

/** List a task's activity timeline (newest first). */
export const listTaskActivity = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.array(activityRowValidator),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await loadAccessibleProject(ctx, task.projectId, args.organizationId);
    const rows = await ctx.db
      .query('taskActivity')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .take(TASK_ACTIVITY_CAP);
    return await enrichWorkflowActivityRows(
      ctx,
      args.organizationId,
      args.taskId,
      rows,
    );
  },
});

// ---------------------------------------------------------------------------
// Task-ops indicators (agent runs + review gate, one bounded read per board)
// ---------------------------------------------------------------------------

const TASK_OPS_INDICATOR_CAP = 50;

/**
 * Live agent-work indicators for an open board: which tasks have a RUNNING
 * agent run, and which have a PENDING review-gate approval. One reactive
 * query per board; both reads are index-backed and bounded, and the
 * invalidation surface is run lifecycle + review responses only.
 */
export const getTaskOpsIndicators = query({
  args: { projectId: v.id('projects'), organizationId: v.string() },
  returns: v.object({
    runningTaskIds: v.array(v.id('tasks')),
    pendingReviews: v.array(
      v.object({
        taskId: v.id('tasks'),
        approvalId: v.id('approvals'),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { project } = await loadAccessibleProject(
      ctx,
      args.projectId,
      args.organizationId,
    );

    const runningTaskIds: Id<'tasks'>[] = [];
    for await (const run of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_project_status', (q) =>
        q.eq('projectId', args.projectId).eq('status', 'running'),
      )) {
      runningTaskIds.push(run.taskId);
      if (runningTaskIds.length >= TASK_OPS_INDICATOR_CAP) break;
    }

    // Pending reviews are rare org-wide, so the org-level pending scan
    // filtered to this project stays tiny (shared with the paginated list's
    // per-row `pendingReview` stamp).
    const pendingByTask = await collectPendingReviewsByTask(
      ctx,
      project.organizationId,
      args.projectId,
    );
    const pendingReviews = [...pendingByTask].map(([taskId, approvalId]) => ({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- task_review approvals store String(taskId) as resourceId
      taskId: taskId as Id<'tasks'>,
      approvalId,
    }));

    return { runningTaskIds, pendingReviews };
  },
});

/**
 * The pending review-gate approval for one task (detail-sheet review card).
 * Returns null when there is nothing to review.
 */
export const getPendingTaskReview = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      approvalId: v.id('approvals'),
      question: v.optional(v.string()),
      agentSlug: v.optional(v.string()),
      requestedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    await loadAccessibleProject(ctx, task.projectId, args.organizationId);
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'task_review')
          .eq('resourceId', String(args.taskId)),
      )) {
      if (approval.status !== 'pending') continue;
      const metadata: unknown = approval.metadata;
      const record = isRecord(metadata) ? metadata : {};
      return {
        approvalId: approval._id,
        question:
          typeof record.question === 'string' ? record.question : undefined,
        agentSlug:
          typeof record.agentSlug === 'string' ? record.agentSlug : undefined,
        requestedAt: approval._creationTime,
      };
    }
    return null;
  },
});

/** Agent run history for one task (detail-sheet "Agent activity" section). */
export const listTaskAgentRuns = query({
  args: { taskId: v.id('tasks'), organizationId: v.string() },
  returns: v.array(
    v.object({
      runId: v.id('taskAgentRuns'),
      agentSlug: v.string(),
      trigger: v.string(),
      status: v.string(),
      error: v.optional(v.string()),
      startedAt: v.number(),
      durationMs: v.optional(v.number()),
      costCents: v.number(),
      workflowSlug: v.optional(v.string()),
      wfExecutionId: v.optional(v.id('wfExecutions')),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await loadAccessibleProject(ctx, task.projectId, args.organizationId);
    const runs = await ctx.db
      .query('taskAgentRuns')
      .withIndex('by_task_started', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .take(20);
    return runs.map((run) => ({
      runId: run._id,
      agentSlug: run.agentSlug,
      trigger: run.trigger,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      costCents: run.costCents,
      workflowSlug: run.workflowSlug,
      wfExecutionId: run.wfExecutionId,
    }));
  },
});

/**
 * Mention trigger preview for the comment and description composers
 * (Multica-style): for each @-mentioned agent slug in the draft, whether
 * saving WILL put that agent to work — and if not, why (project gate,
 * automation kill switch, or circuit breaker). Read-only and cheap: one
 * task + policy read for the whole slug set (≤10). Pass `taskId` for an
 * existing task, or `projectId` alone for create mode (no task yet — the
 * per-task breaker check is skipped).
 *
 * The `agent_not_live` / `budget_paused` / `queued_likely` reasons stay in
 * the return union for shape stability, but are never produced any more:
 * they were read from the `agentInstallations` / `agentGuardrailNotices`
 * tables, which the 0.4 baseline reset dropped (agents now come from the
 * file-based roster, and no guardrail bookkeeping exists yet).
 */
export const mentionTriggerPreview = query({
  args: {
    taskId: v.optional(v.id('tasks')),
    projectId: v.optional(v.id('projects')),
    organizationId: v.string(),
    slugs: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      slug: v.string(),
      willTrigger: v.boolean(),
      reason: v.union(
        v.literal('ok'),
        v.literal('queued_likely'),
        v.literal('not_mentionable'),
        v.literal('agent_not_live'),
        v.literal('pack_disabled'),
        v.literal('breaker_paused'),
        v.literal('budget_paused'),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    let task: Doc<'tasks'> | null = null;
    if (args.taskId) {
      task = await ctx.db.get(args.taskId);
      if (!task) {
        throw new ConvexError({
          code: 'TASK_NOT_FOUND',
          message: 'TASK_NOT_FOUND',
        });
      }
    }
    const projectId = task?.projectId ?? args.projectId;
    if (!projectId) {
      throw new ConvexError({
        code: 'TASK_OR_PROJECT_REQUIRED',
        message: 'TASK_OR_PROJECT_REQUIRED',
      });
    }
    const { project } = await loadAccessibleProject(
      ctx,
      projectId,
      args.organizationId,
    );
    const organizationId = project.organizationId;

    const slugs = [...new Set(args.slugs)].slice(0, 10);
    if (slugs.length === 0) return [];

    // Project agent gate (mirrors `buildMentionDirectory`): 'restricted'
    // projects limit mentionable agents to their explicit lists; the default
    // 'all' mode exposes every org agent. The roster itself is file-based and
    // not enumerable here, so in 'all' mode existence isn't verified — the
    // composer only offers real slugs, and a fabricated one no-ops quietly at
    // run admission.
    const restricted = (project.agentMode ?? 'all') === 'restricted';
    const mentionable = new Set<string>([
      ...(project.allowedAgentSlugs ?? []),
      ...(project.recommendedAgentSlugs ?? []),
    ]);

    const automationRaw = await readPolicyConfig<{ enabled?: boolean }>(
      ctx,
      organizationId,
      'task_automation',
    );
    const packEnabled = automationRaw?.enabled !== false;
    const breakerPaused = task ? task.agentRunsPausedAt !== undefined : false;

    const rows: Array<{
      slug: string;
      willTrigger: boolean;
      reason:
        | 'ok'
        | 'queued_likely'
        | 'not_mentionable'
        | 'agent_not_live'
        | 'pack_disabled'
        | 'breaker_paused'
        | 'budget_paused';
    }> = [];
    for (const slug of slugs) {
      if (restricted && !mentionable.has(slug)) {
        rows.push({ slug, willTrigger: false, reason: 'not_mentionable' });
        continue;
      }
      if (!packEnabled) {
        rows.push({ slug, willTrigger: false, reason: 'pack_disabled' });
        continue;
      }
      if (breakerPaused) {
        rows.push({ slug, willTrigger: false, reason: 'breaker_paused' });
        continue;
      }
      rows.push({ slug, willTrigger: true, reason: 'ok' });
    }
    return rows;
  },
});
