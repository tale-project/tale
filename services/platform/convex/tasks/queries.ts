/**
 * Tasks feature queries (read side).
 *
 * Every query loads the parent project once and gates the whole result on
 * `checkProjectAccess` — a task inherits its project's ACL. Board reads are
 * capped per project (`TASK_BOARD_CAP`) with a `truncated` flag, mirroring the
 * `getProjectStats` bounded-scan pattern; the M1 board groups by status +
 * orders by `rank` client-side.
 */

import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { canClaimTask, checkProjectAccess } from './access';
import {
  boardViewFiltersValidator,
  boardViewScopeValidator,
  boardViewTypeValidator,
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

const TASK_BOARD_CAP = 2000;
const TASK_COMMENTS_CAP = 500;
const TASK_ACTIVITY_CAP = 500;

async function getAuthContext(
  ctx: QueryCtx,
  organizationId: string,
): Promise<{ userId: string; role: string; teamIds: string[] }> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  const member = await getOrganizationMember(ctx, organizationId, authUser);
  const teamIds = await getUserTeamIds(ctx, member.userId);
  return { userId: member.userId, role: member.role, teamIds };
}

async function loadAccessibleProject(
  ctx: QueryCtx,
  projectId: Id<'projects'>,
): Promise<{
  project: Doc<'projects'>;
  auth: { userId: string; role: string; teamIds: string[] };
  canEdit: boolean;
}> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const auth = await getAuthContext(ctx, project.organizationId);
  const access = checkProjectAccess(project, auth.teamIds, auth.role);
  if (!access.canRead) throw new Error('TASK_FORBIDDEN');
  return { project, auth, canEdit: access.canEdit };
}

export const taskRowValidator = v.object({
  _id: v.id('tasks'),
  _creationTime: v.number(),
  organizationId: v.string(),
  projectId: v.id('projects'),
  title: v.string(),
  description: v.optional(v.string()),
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
  createdBy: v.string(),
  createdByType: taskActorTypeValidator,
  claimedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
});

const commentRowValidator = v.object({
  _id: v.id('taskComments'),
  _creationTime: v.number(),
  organizationId: v.string(),
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  authorType: taskActorTypeValidator,
  authorId: v.string(),
  body: v.string(),
  parentCommentId: v.optional(v.id('taskComments')),
  mentions: v.optional(
    v.array(v.object({ type: taskActorTypeValidator, id: v.string() })),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
  editedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
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
    includeArchived: v.optional(v.boolean()),
    status: v.optional(taskStatusValidator),
    assigneeId: v.optional(v.string()),
  },
  returns: v.object({
    tasks: v.array(taskRowValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { project } = await loadAccessibleProject(ctx, args.projectId);

    const rows: Doc<'tasks'>[] = [];
    let truncated = false;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))) {
      if (!args.includeArchived && task.archivedAt) continue;
      if (args.status && task.status !== args.status) continue;
      if (args.assigneeId && task.assigneeId !== args.assigneeId) continue;
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

    return { tasks: rows, truncated };
  },
});

/** Fetch a single task with the caller's edit/claim affordances. */
export const getTask = query({
  args: { taskId: v.id('tasks') },
  returns: v.union(
    v.null(),
    v.object({
      task: taskRowValidator,
      canEdit: v.boolean(),
      canClaim: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const { canEdit } = await loadAccessibleProject(ctx, task.projectId);
    return { task, canEdit, canClaim: canEdit && canClaimTask(task) };
  },
});

/** List direct subtasks of a task. */
export const listSubtasks = query({
  args: { taskId: v.id('tasks') },
  returns: v.array(taskRowValidator),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.taskId);
    if (!parent) return [];
    await loadAccessibleProject(ctx, parent.projectId);
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
  args: { taskId: v.id('tasks') },
  returns: v.object({
    blockedBy: v.array(taskRowValidator),
    blocks: v.array(taskRowValidator),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return { blockedBy: [], blocks: [] };
    await loadAccessibleProject(ctx, task.projectId);

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
  args: { projectId: v.id('projects') },
  returns: v.array(
    v.object({
      blockerTaskId: v.id('tasks'),
      blockedTaskId: v.id('tasks'),
    }),
  ),
  handler: async (ctx, args) => {
    await loadAccessibleProject(ctx, args.projectId);
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

/** List a task's comments (oldest first), excluding soft-deleted ones. */
export const listTaskComments = query({
  args: { taskId: v.id('tasks') },
  returns: v.array(commentRowValidator),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await loadAccessibleProject(ctx, task.projectId);
    const comments = await ctx.db
      .query('taskComments')
      .withIndex('by_task_createdAt', (q) => q.eq('taskId', args.taskId))
      .order('asc')
      .take(TASK_COMMENTS_CAP);
    return comments.filter((c) => !c.deletedAt);
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
  args: { projectId: v.id('projects') },
  returns: v.array(boardViewRowValidator),
  handler: async (ctx, args) => {
    const { auth } = await loadAccessibleProject(ctx, args.projectId);
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
  args: { taskId: v.id('tasks') },
  returns: v.array(activityRowValidator),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await loadAccessibleProject(ctx, task.projectId);
    return await ctx.db
      .query('taskActivity')
      .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .take(TASK_ACTIVITY_CAP);
  },
});
