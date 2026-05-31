/**
 * Tasks feature mutations (user-facing).
 *
 * Every mutation:
 *  - resolves auth via `getAuthContext` (org membership + role + teams),
 *  - gates on the PARENT PROJECT's access via `checkProjectAccess`
 *    (a task inherits its project's ACL — see `tasks/access.ts`),
 *  - writes a `createAuditLog` entry (governance trail) AND a `taskActivity`
 *    row (product-facing timeline),
 *  - emits domain events via `emitEvent` for the automation engine.
 *
 * Mirrors the structure of `projects/mutations.ts`.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import {
  autoSubscribe,
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskStatusChanged,
} from '../collab/notify';
import { getUserTeamIds } from '../lib/get_user_teams';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { getOrganizationMember } from '../lib/rls';
import { emitEvent } from '../workflows/triggers/emit_event';
import { canClaimTask, checkProjectAccess, normalizeAssignee } from './access';
import {
  TASK_AUDIT_ACTIONS,
  TASK_COMMENT_RESOURCE_TYPE,
  TASK_RESOURCE_TYPE,
} from './audit_actions';
import { buildMentionDirectory } from './directory';
import {
  computeEndRank,
  hasOpenChildren,
  nextTaskNumber,
  recordActivity,
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
  TERMINAL_STATUSES,
} from './helpers';
import { extractMentions } from './mentions';
import { rankBetween } from './rank';
import {
  boardViewFiltersValidator,
  boardViewTypeValidator,
  boardViewScopeValidator,
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

const BULK_UPDATE_MAX = 100;

const ADMIN_ROLES = new Set(['owner', 'admin']);

/** Map rate-limiter exceptions to a structured ConvexError the UI handles. */
function mapRateLimitError(error: unknown): never {
  if (error instanceof RateLimitExceededError) {
    throw new ConvexError({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: error.retryAfter },
    });
  }
  throw error;
}

interface AuthContext {
  userId: string;
  email?: string;
  role: string;
  teamIds: string[];
}

async function getAuthContext(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuthContext> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

  const member = await getOrganizationMember(ctx, organizationId, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  const teamIds = await getUserTeamIds(ctx, member.userId);
  return {
    userId: member.userId,
    email: authUser.email,
    role: member.role,
    teamIds,
  };
}

async function loadTaskOrThrow(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<Doc<'tasks'>> {
  const task = await ctx.db.get(taskId);
  if (!task) throw new ConvexError({ code: 'TASK_NOT_FOUND' });
  return task;
}

async function loadProjectOrThrow(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
  return project;
}

function assertTaskReadable(project: Doc<'projects'>, auth: AuthContext): void {
  if (!checkProjectAccess(project, auth.teamIds, auth.role).canRead) {
    throw new ConvexError({ code: 'TASK_FORBIDDEN' });
  }
}

function assertTaskWritable(project: Doc<'projects'>, auth: AuthContext): void {
  const access = checkProjectAccess(project, auth.teamIds, auth.role);
  if (!access.canRead) throw new ConvexError({ code: 'TASK_FORBIDDEN' });
  if (!access.canEdit) throw new ConvexError({ code: 'RBAC_FORBIDDEN' });
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > TASK_TITLE_MAX) {
    throw new ConvexError({ code: 'TASK_TITLE_INVALID' });
  }
  return trimmed;
}

function validateDescription(
  description: string | undefined,
): string | undefined {
  if (description == null) return undefined;
  if (description.length > TASK_DESCRIPTION_MAX) {
    throw new ConvexError({ code: 'TASK_DESCRIPTION_TOO_LONG' });
  }
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateLabels(labels: string[] | undefined): string[] | undefined {
  if (labels == null) return undefined;
  if (labels.length > TASK_LABELS_MAX) {
    throw new ConvexError({ code: 'TASK_LABELS_INVALID' });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const label = raw.trim().toLowerCase();
    if (label.length === 0 || label.length > TASK_LABEL_CHARS_MAX) {
      throw new ConvexError({ code: 'TASK_LABELS_INVALID' });
    }
    if (!seen.has(label)) {
      seen.add(label);
      normalized.push(label);
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createTask = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    priority: v.optional(taskPriorityValidator),
    labels: v.optional(v.array(v.string())),
    assigneeType: v.optional(taskActorTypeValidator),
    assigneeId: v.optional(v.string()),
    parentTaskId: v.optional(v.id('tasks')),
  },
  returns: v.id('tasks'),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    if (project.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'ORG_FORBIDDEN' });
    }
    const auth = await getAuthContext(ctx, args.organizationId);
    assertTaskWritable(project, auth);

    try {
      await checkUserRateLimit(ctx, 'task:create', auth.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    const title = validateTitle(args.title);
    const description = validateDescription(args.description);
    const labels = validateLabels(args.labels);
    const status = args.status ?? 'backlog';
    const assignee = normalizeAssignee({
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
    });

    if (args.parentTaskId) {
      const parent = await loadTaskOrThrow(ctx, args.parentTaskId);
      if (parent.projectId !== args.projectId) {
        throw new ConvexError({ code: 'TASK_PARENT_PROJECT_MISMATCH' });
      }
      if (parent.archivedAt) {
        throw new ConvexError({ code: 'TASK_PARENT_ARCHIVED' });
      }
    }

    const now = Date.now();
    const rank = await computeEndRank(ctx, args.projectId, status);
    const number = await nextTaskNumber(ctx, project);

    const taskId = await ctx.db.insert('tasks', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      title,
      description,
      status,
      priority: args.priority,
      labels,
      assigneeType: assignee?.assigneeType,
      assigneeId: assignee?.assigneeId,
      parentTaskId: args.parentTaskId,
      rank,
      number,
      createdBy: auth.userId,
      createdByType: 'user',
      createdAt: now,
      updatedAt: now,
    });

    const task = await ctx.db.get(taskId);
    if (task) {
      await recordActivity(ctx, {
        task,
        actorType: 'user',
        actorId: auth.userId,
        action: 'created',
        toValue: status,
      });
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.created,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(taskId),
      resourceName: title,
      newState: { status, priority: args.priority ?? null },
      metadata: {
        projectId: String(args.projectId),
        parentTaskId: args.parentTaskId ? String(args.parentTaskId) : null,
        assigneeType: assignee?.assigneeType ?? null,
      },
      status: 'success',
    });

    if (task) {
      await autoSubscribe(ctx, {
        task,
        subscriberType: 'user',
        subscriberId: auth.userId,
        reason: 'creator',
      });
      if (assignee) {
        await notifyTaskAssigned(ctx, {
          task,
          assigneeType: assignee.assigneeType,
          assigneeId: assignee.assigneeId,
          actorType: 'user',
          actorId: auth.userId,
        });
      }
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.created',
        eventData: { task },
      });
    }

    return taskId;
  },
});

// ---------------------------------------------------------------------------
// Update identity / priority / labels
// ---------------------------------------------------------------------------

export const updateTask = mutation({
  args: {
    taskId: v.id('tasks'),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(v.union(taskPriorityValidator, v.null())),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    const patch: Partial<Doc<'tasks'>> = { updatedAt: Date.now() };
    const changedFields: string[] = [];

    if (args.title !== undefined) {
      patch.title = validateTitle(args.title);
      changedFields.push('title');
    }
    if (args.description !== undefined) {
      patch.description =
        args.description === null
          ? undefined
          : validateDescription(args.description);
      changedFields.push('description');
    }
    if (args.priority !== undefined) {
      patch.priority = args.priority === null ? undefined : args.priority;
      changedFields.push('priority');
    }
    if (args.labels !== undefined) {
      patch.labels = validateLabels(args.labels);
      changedFields.push('labels');
    }

    if (changedFields.length === 0) return null;

    await ctx.db.patch(args.taskId, patch);
    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'updated',
      toValue: changedFields.join(','),
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.updated,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: patch.title ?? task.title,
      changedFields,
      status: 'success',
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// Status transition (with parent-close guard)
// ---------------------------------------------------------------------------

export const updateTaskStatus = mutation({
  args: {
    taskId: v.id('tasks'),
    status: taskStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    if (task.status === args.status) return null;

    // Parent cannot close while it has open (non-terminal, non-archived) children.
    if (
      TERMINAL_STATUSES.has(args.status) &&
      (await hasOpenChildren(ctx, args.taskId))
    ) {
      throw new ConvexError({ code: 'TASK_HAS_OPEN_SUBTASKS' });
    }

    const now = Date.now();
    // Moving columns: append to the end of the destination column.
    const rank = await computeEndRank(ctx, task.projectId, args.status);
    // Preserve the original completion time on a re-close (mirrors moveTask);
    // only stamp `now` the first time the task enters a terminal status.
    const completedAt = TERMINAL_STATUSES.has(args.status)
      ? (task.completedAt ?? now)
      : undefined;

    await ctx.db.patch(args.taskId, {
      status: args.status,
      rank,
      completedAt,
      updatedAt: now,
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'status.changed',
      fromValue: task.status,
      toValue: args.status,
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.statusChanged,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      previousState: { status: task.status },
      newState: { status: args.status },
      status: 'success',
    });

    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await notifyTaskStatusChanged(ctx, {
        task: updated,
        fromStatus: task.status,
        toStatus: args.status,
        actorType: 'user',
        actorId: auth.userId,
      });
      await emitEvent(ctx, {
        organizationId: task.organizationId,
        eventType: 'task.status_changed',
        eventData: {
          task: updated,
          fromStatus: task.status,
          toStatus: args.status,
        },
      });
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Assign / unassign (set or clear the polymorphic single assignee)
// ---------------------------------------------------------------------------

export const assignTask = mutation({
  args: {
    taskId: v.id('tasks'),
    assigneeType: v.optional(taskActorTypeValidator),
    assigneeId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    const assignee = normalizeAssignee({
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
    });
    const previousAssigneeId = task.assigneeId ?? null;

    await ctx.db.patch(args.taskId, {
      assigneeType: assignee?.assigneeType,
      assigneeId: assignee?.assigneeId,
      updatedAt: Date.now(),
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'assignee.changed',
      fromValue: previousAssigneeId ?? undefined,
      toValue: assignee?.assigneeId,
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: assignee
        ? TASK_AUDIT_ACTIONS.assigned
        : TASK_AUDIT_ACTIONS.unassigned,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      previousState: { assigneeId: previousAssigneeId },
      newState: { assigneeId: assignee?.assigneeId ?? null },
      status: 'success',
    });

    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await notifyTaskAssigned(ctx, {
        task: updated,
        assigneeType: assignee?.assigneeType ?? null,
        assigneeId: assignee?.assigneeId ?? null,
        actorType: 'user',
        actorId: auth.userId,
      });
      await emitEvent(ctx, {
        organizationId: task.organizationId,
        eventType: 'task.assigned',
        eventData: {
          task: updated,
          assigneeType: assignee?.assigneeType ?? null,
          assigneeId: assignee?.assigneeId ?? null,
          previousAssigneeId,
        },
      });
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Claim (atomic self-assign by the current user)
// ---------------------------------------------------------------------------

export const claimTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.object({
    claimed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    // Atomic under Convex single-transaction OCC: the read above + the patch
    // below run against a consistent snapshot; a concurrent claimer's tx
    // retries and re-reads this assignee, so exactly one claimer wins.
    if (!canClaimTask(task)) {
      return { claimed: false, reason: 'ALREADY_CLAIMED' };
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      assigneeType: 'user',
      assigneeId: auth.userId,
      claimedAt: now,
      updatedAt: now,
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'claimed',
      toValue: auth.userId,
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.claimed,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      newState: { assigneeId: auth.userId },
      status: 'success',
    });

    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await notifyTaskAssigned(ctx, {
        task: updated,
        assigneeType: 'user',
        assigneeId: auth.userId,
        actorType: 'user',
        actorId: auth.userId,
      });
      await emitEvent(ctx, {
        organizationId: task.organizationId,
        eventType: 'task.assigned',
        eventData: {
          task: updated,
          assigneeType: 'user',
          assigneeId: auth.userId,
          previousAssigneeId: null,
        },
      });
    }

    return { claimed: true };
  },
});

// ---------------------------------------------------------------------------
// Comment (with @mention parsing)
// ---------------------------------------------------------------------------

export const addTaskComment = mutation({
  args: {
    taskId: v.id('tasks'),
    body: v.string(),
  },
  returns: v.id('taskComments'),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    const body = args.body.trim();
    if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
      throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
    }

    try {
      await checkUserRateLimit(ctx, 'task:comment', auth.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    const directory = await buildMentionDirectory(ctx, {
      organizationId: task.organizationId,
      project,
    });
    const mentions = extractMentions(body, directory);

    const now = Date.now();
    const commentId = await ctx.db.insert('taskComments', {
      organizationId: task.organizationId,
      taskId: args.taskId,
      projectId: task.projectId,
      authorType: 'user',
      authorId: auth.userId,
      body,
      mentions: mentions.length > 0 ? mentions : undefined,
      createdAt: now,
      updatedAt: now,
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'comment.added',
    });

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.commentCreated,
      category: 'data',
      resourceType: TASK_COMMENT_RESOURCE_TYPE,
      resourceId: String(commentId),
      resourceName: task.title,
      metadata: {
        taskId: String(args.taskId),
        mentionCount: mentions.length,
      },
      status: 'success',
    });

    await notifyTaskComment(ctx, {
      task,
      commentId,
      mentions,
      actorType: 'user',
      actorId: auth.userId,
    });

    const comment = await ctx.db.get(commentId);
    await emitEvent(ctx, {
      organizationId: task.organizationId,
      eventType: 'comment.created',
      eventData: { comment, taskId: String(args.taskId) },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: task.organizationId,
        eventType: 'comment.mentioned',
        eventData: { comment, taskId: String(args.taskId), mentions },
      });
    }

    return commentId;
  },
});

// ---------------------------------------------------------------------------
// Archive / restore (soft delete)
// ---------------------------------------------------------------------------

export const archiveTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);
    if (task.archivedAt) return null;

    await ctx.db.patch(args.taskId, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'archived',
    });
    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.archived,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      status: 'success',
    });
    return null;
  },
});

export const restoreTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);
    if (!task.archivedAt) return null;

    await ctx.db.patch(args.taskId, {
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'restored',
    });
    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.restored,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      status: 'success',
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Board: move (drag-to-status + reorder) and bulk actions
// ---------------------------------------------------------------------------

/**
 * Move/reorder a task on the board: optionally change `status` and place it
 * between two neighbours (`beforeTaskId` ranks above, `afterTaskId` below) by
 * computing a fractional `rank`. With no neighbours, appends to the end of the
 * destination column. Enforces the parent-close guard on a terminal move.
 */
export const moveTask = mutation({
  args: {
    taskId: v.id('tasks'),
    status: taskStatusValidator,
    beforeTaskId: v.optional(v.id('tasks')),
    afterTaskId: v.optional(v.id('tasks')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    const statusChanged = task.status !== args.status;
    if (
      statusChanged &&
      TERMINAL_STATUSES.has(args.status) &&
      (await hasOpenChildren(ctx, args.taskId))
    ) {
      throw new ConvexError({ code: 'TASK_HAS_OPEN_SUBTASKS' });
    }

    const beforeRank = args.beforeTaskId
      ? (await ctx.db.get(args.beforeTaskId))?.rank
      : undefined;
    const afterRank = args.afterTaskId
      ? (await ctx.db.get(args.afterTaskId))?.rank
      : undefined;

    let rank: string;
    try {
      rank =
        beforeRank == null && afterRank == null
          ? await computeEndRank(ctx, task.projectId, args.status)
          : rankBetween(beforeRank, afterRank);
    } catch (error) {
      // Neighbours out of order / stale (or no key fits between them) — fall
      // back to the end of the column rather than persisting a bad rank.
      console.warn('[tasks] moveTask: rankBetween failed, appending', error);
      rank = await computeEndRank(ctx, task.projectId, args.status);
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: args.status,
      rank,
      completedAt: TERMINAL_STATUSES.has(args.status)
        ? (task.completedAt ?? now)
        : undefined,
      updatedAt: now,
    });

    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: statusChanged ? 'status.changed' : 'reordered',
      fromValue: statusChanged ? task.status : undefined,
      toValue: statusChanged ? args.status : undefined,
    });

    if (statusChanged) {
      await createAuditLog(ctx, {
        organizationId: task.organizationId,
        actorId: auth.userId,
        actorEmail: auth.email,
        actorType: 'user',
        action: TASK_AUDIT_ACTIONS.statusChanged,
        category: 'data',
        resourceType: TASK_RESOURCE_TYPE,
        resourceId: String(args.taskId),
        resourceName: task.title,
        previousState: { status: task.status },
        newState: { status: args.status },
        status: 'success',
      });
      const updated = await ctx.db.get(args.taskId);
      if (updated) {
        await emitEvent(ctx, {
          organizationId: task.organizationId,
          eventType: 'task.status_changed',
          eventData: {
            task: updated,
            fromStatus: task.status,
            toStatus: args.status,
          },
        });
      }
    }

    return null;
  },
});

/**
 * Apply a single change to many tasks at once (board/table bulk actions). All
 * tasks must belong to projects the caller can edit. Capped at
 * {@link BULK_UPDATE_MAX} ids per call.
 */
export const bulkUpdateTasks = mutation({
  args: {
    taskIds: v.array(v.id('tasks')),
    status: v.optional(taskStatusValidator),
    priority: v.optional(v.union(taskPriorityValidator, v.null())),
    assigneeType: v.optional(taskActorTypeValidator),
    assigneeId: v.optional(v.string()),
    clearAssignee: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
  },
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    if (args.taskIds.length === 0) return { updated: 0, skipped: 0 };
    if (args.taskIds.length > BULK_UPDATE_MAX) {
      throw new ConvexError({ code: 'TASK_BULK_TOO_LARGE' });
    }

    const assignee = args.clearAssignee
      ? null
      : normalizeAssignee({
          assigneeType: args.assigneeType,
          assigneeId: args.assigneeId,
        });

    let updated = 0;
    let skipped = 0;
    const now = Date.now();
    const projectAccessCache = new Map<string, boolean>();

    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task) {
        skipped += 1;
        continue;
      }
      const projectKey = String(task.projectId);
      let canEdit = projectAccessCache.get(projectKey);
      if (canEdit === undefined) {
        try {
          const project = await ctx.db.get(task.projectId);
          const auth = await getAuthContext(ctx, task.organizationId);
          canEdit = project
            ? checkProjectAccess(project, auth.teamIds, auth.role).canEdit
            : false;
        } catch (error) {
          // The caller isn't a member of this task's org (getAuthContext
          // throws). Skip the task rather than aborting the whole batch.
          console.warn(
            '[tasks] bulkUpdate: auth failed for task org, skipping',
            error,
          );
          canEdit = false;
        }
        projectAccessCache.set(projectKey, canEdit);
      }
      if (!canEdit) {
        skipped += 1;
        continue;
      }

      const patch: Partial<Doc<'tasks'>> = { updatedAt: now };
      if (args.status !== undefined) {
        if (
          TERMINAL_STATUSES.has(args.status) &&
          (await hasOpenChildren(ctx, taskId))
        ) {
          skipped += 1;
          continue;
        }
        patch.status = args.status;
        patch.rank = await computeEndRank(ctx, task.projectId, args.status);
        patch.completedAt = TERMINAL_STATUSES.has(args.status)
          ? (task.completedAt ?? now)
          : undefined;
      }
      if (args.priority !== undefined) {
        patch.priority = args.priority === null ? undefined : args.priority;
      }
      if (args.clearAssignee || assignee) {
        patch.assigneeType = assignee?.assigneeType;
        patch.assigneeId = assignee?.assigneeId;
      }
      if (args.archived !== undefined) {
        patch.archivedAt = args.archived ? now : undefined;
      }
      await ctx.db.patch(taskId, patch);
      updated += 1;
    }

    return { updated, skipped };
  },
});

// ---------------------------------------------------------------------------
// Board views (saved filters/layouts)
// ---------------------------------------------------------------------------

export const saveBoardView = mutation({
  args: {
    viewId: v.optional(v.id('boardViews')),
    projectId: v.id('projects'),
    name: v.string(),
    scope: boardViewScopeValidator,
    viewType: boardViewTypeValidator,
    filters: boardViewFiltersValidator,
    sort: v.optional(v.object({ field: v.string(), desc: v.boolean() })),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.id('boardViews'),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);

    const name = args.name.trim();
    if (name.length === 0 || name.length > 80) {
      throw new ConvexError({ code: 'BOARD_VIEW_NAME_INVALID' });
    }
    const now = Date.now();

    if (args.viewId) {
      const existing = await ctx.db.get(args.viewId);
      if (!existing || existing.projectId !== args.projectId) {
        throw new ConvexError({ code: 'BOARD_VIEW_NOT_FOUND' });
      }
      // Personal views can only be edited by their owner.
      if (existing.scope === 'personal' && existing.ownerId !== auth.userId) {
        throw new ConvexError({ code: 'BOARD_VIEW_FORBIDDEN' });
      }
      await ctx.db.patch(args.viewId, {
        name,
        scope: args.scope,
        viewType: args.viewType,
        filters: args.filters,
        sort: args.sort,
        isDefault: args.isDefault,
        updatedAt: now,
      });
      return args.viewId;
    }

    return await ctx.db.insert('boardViews', {
      organizationId: project.organizationId,
      projectId: args.projectId,
      ownerId: auth.userId,
      name,
      scope: args.scope,
      viewType: args.viewType,
      filters: args.filters,
      sort: args.sort,
      isDefault: args.isDefault,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteBoardView = mutation({
  args: { viewId: v.id('boardViews') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const view = await ctx.db.get(args.viewId);
    if (!view) return null;
    const project = await loadProjectOrThrow(ctx, view.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);
    if (view.scope === 'personal' && view.ownerId !== auth.userId) {
      throw new ConvexError({ code: 'BOARD_VIEW_FORBIDDEN' });
    }
    await ctx.db.delete(args.viewId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Hard delete (admin) — cascades children + comments + activity
// ---------------------------------------------------------------------------

export const deleteTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.object({ deletedChildCount: v.number() }),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskReadable(project, auth);
    if (!ADMIN_ROLES.has(auth.role)) {
      throw new ConvexError({ code: 'ROLE_FORBIDDEN' });
    }

    const deletedChildren = await deleteTaskTree(ctx, args.taskId);

    await createAuditLog(ctx, {
      organizationId: task.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.deleted,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      metadata: { deletedChildCount: deletedChildren },
      status: 'success',
    });

    await emitEvent(ctx, {
      organizationId: task.organizationId,
      eventType: 'task.deleted',
      eventData: {
        taskId: String(args.taskId),
        projectId: String(task.projectId),
      },
    });

    return { deletedChildCount: deletedChildren };
  },
});

/** Recursively delete a task, its subtasks, and their comments + activity. */
async function deleteTaskTree(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<number> {
  let deletedChildren = 0;
  // Collect child ids first, then recurse — deleting rows while iterating the
  // same `by_parent` cursor would mutate what we're scanning.
  const childIds: Id<'tasks'>[] = [];
  for await (const child of ctx.db
    .query('tasks')
    .withIndex('by_parent', (q) => q.eq('parentTaskId', taskId))) {
    childIds.push(child._id);
  }
  for (const childId of childIds) {
    deletedChildren += 1 + (await deleteTaskTree(ctx, childId));
  }

  for await (const comment of ctx.db
    .query('taskComments')
    .withIndex('by_task_createdAt', (q) => q.eq('taskId', taskId))) {
    await ctx.db.delete(comment._id);
  }
  for await (const activity of ctx.db
    .query('taskActivity')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
    await ctx.db.delete(activity._id);
  }
  await ctx.db.delete(taskId);
  return deletedChildren;
}
