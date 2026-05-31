/**
 * Internal mutations for the tasks feature, invoked by the agent tools
 * (`agent_tools/tasks/*`) via `ctx.runMutation`.
 *
 * These run the write with ORGANIZATION ISOLATION (the project/task must belong
 * to the agent's `organizationId`) but without team-based project access —
 * agents are not team members; which agents may act at all is gated upstream by
 * `project.agentMode`/`allowedAgentSlugs`. Writes are attributed in the
 * task-domain tables as `actorType: 'agent'` with `actorId` (the agent's
 * identity passed from the tool), and in the governance audit log as
 * `actorType: 'api'` with `metadata.viaAgent` (the audit union has no 'agent').
 */

import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskStatusChanged,
} from '../collab/notify';
import { emitEvent } from '../workflows/triggers/emit_event';
import { canClaimTask, normalizeAssignee } from './access';
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
  TASK_TITLE_MAX,
  TERMINAL_STATUSES,
} from './helpers';
import { extractMentions } from './mentions';
import {
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

async function loadTaskInOrg(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
  organizationId: string,
): Promise<Doc<'tasks'>> {
  const task = await ctx.db.get(taskId);
  if (!task || task.organizationId !== organizationId) {
    throw new ConvexError({ code: 'TASK_NOT_FOUND' });
  }
  return task;
}

async function loadProjectInOrg(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  organizationId: string,
): Promise<Doc<'projects'>> {
  const project = await ctx.db.get(projectId);
  if (!project || project.organizationId !== organizationId) {
    throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
  }
  return project;
}

function trimTitle(title: string): string {
  const t = title.trim();
  if (t.length === 0 || t.length > TASK_TITLE_MAX) {
    throw new ConvexError({ code: 'TASK_TITLE_INVALID' });
  }
  return t;
}

async function agentAudit(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(ctx, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorType: 'api',
    action: args.action,
    category: 'data',
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    resourceName: args.resourceName,
    metadata: { viaAgent: true, ...args.metadata },
    status: 'success',
  });
}

export const agentCreateTask = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    priority: v.optional(taskPriorityValidator),
    labels: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id('tasks')),
  },
  handler: async (ctx, args): Promise<{ taskId: Id<'tasks'> }> => {
    const project = await loadProjectInOrg(
      ctx,
      args.projectId,
      args.organizationId,
    );
    const title = trimTitle(args.title);
    const status = args.status ?? 'backlog';

    if (args.parentTaskId) {
      const parent = await loadTaskInOrg(
        ctx,
        args.parentTaskId,
        args.organizationId,
      );
      if (parent.projectId !== args.projectId) {
        throw new ConvexError({ code: 'TASK_PARENT_PROJECT_MISMATCH' });
      }
    }

    const now = Date.now();
    const rank = await computeEndRank(ctx, args.projectId, status);
    const number = await nextTaskNumber(ctx, project);
    const taskId = await ctx.db.insert('tasks', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      title,
      description: args.description?.trim() || undefined,
      status,
      priority: args.priority,
      labels: args.labels,
      parentTaskId: args.parentTaskId,
      rank,
      number,
      createdBy: args.actorId,
      createdByType: 'agent',
      createdAt: now,
      updatedAt: now,
    });

    const task = await ctx.db.get(taskId);
    if (task) {
      await recordActivity(ctx, {
        task,
        actorType: 'agent',
        actorId: args.actorId,
        action: 'created',
        toValue: status,
      });
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.created',
        eventData: { task },
      });
    }
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.created,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(taskId),
      resourceName: title,
      metadata: { projectId: String(args.projectId) },
    });

    return { taskId };
  },
});

/**
 * Neutral inbox column a newly-synced (or reopened) external item lands in.
 * Newly-synced open items and reopened-from-terminal items both go here; local
 * triage owns every move after that.
 */
const SYNC_OPEN_STATUS = 'backlog' as const;

/**
 * Upsert a task from an external system, keyed by the
 * `(organizationId, externalSystem, externalId)` natural key. Idempotent: a
 * re-sync of the same external item patches the existing task instead of
 * creating a duplicate (mirrors the `documents.externalItemId` upsert).
 *
 * Status policy keeps local triage authoritative while letting the external
 * system own the open/closed lifecycle:
 *  - create: `closed` → 'done', otherwise → {@link SYNC_OPEN_STATUS}
 *  - existing + `closed`: move to 'done' (unless already terminal)
 *  - existing + `open`: reopen to {@link SYNC_OPEN_STATUS} only if currently terminal
 *  - otherwise the local status is left untouched
 *
 * Drives the GitHub issue-sync automation (examples/default/workflows/github/)
 * through the generic `task` workflow action — there is no GitHub-specific
 * backend code.
 */
export const agentUpsertTaskByExternalRef = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    projectId: v.id('projects'),
    externalSystem: v.string(),
    externalId: v.string(),
    title: v.string(),
    externalUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    priority: v.optional(taskPriorityValidator),
    externalState: v.optional(v.union(v.literal('open'), v.literal('closed'))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ taskId: Id<'tasks'>; created: boolean }> => {
    const project = await loadProjectInOrg(
      ctx,
      args.projectId,
      args.organizationId,
    );
    const title = trimTitle(args.title);
    const description = args.description?.trim() || undefined;
    const now = Date.now();

    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_org_external', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('externalSystem', args.externalSystem)
          .eq('externalId', args.externalId),
      )
      .first();

    if (existing) {
      const patch: Partial<Doc<'tasks'>> = {
        title,
        description,
        labels: args.labels,
        externalUrl: args.externalUrl,
        updatedAt: now,
      };
      // The external lifecycle drives done/reopen; local triage owns the rest.
      let statusFrom: Doc<'tasks'>['status'] | undefined;
      if (
        args.externalState === 'closed' &&
        !TERMINAL_STATUSES.has(existing.status)
      ) {
        statusFrom = existing.status;
        patch.status = 'done';
        patch.completedAt = now;
        patch.rank = await computeEndRank(ctx, existing.projectId, 'done');
      } else if (
        args.externalState === 'open' &&
        TERMINAL_STATUSES.has(existing.status)
      ) {
        statusFrom = existing.status;
        patch.status = SYNC_OPEN_STATUS;
        patch.completedAt = undefined;
        patch.rank = await computeEndRank(
          ctx,
          existing.projectId,
          SYNC_OPEN_STATUS,
        );
      }
      await ctx.db.patch(existing._id, patch);
      if (statusFrom && patch.status) {
        await recordActivity(ctx, {
          task: existing,
          actorType: 'agent',
          actorId: args.actorId,
          action: 'status.changed',
          fromValue: statusFrom,
          toValue: patch.status,
        });
      }
      await agentAudit(ctx, {
        organizationId: args.organizationId,
        actorId: args.actorId,
        action: TASK_AUDIT_ACTIONS.updated,
        resourceType: TASK_RESOURCE_TYPE,
        resourceId: String(existing._id),
        resourceName: title,
        metadata: {
          externalSystem: args.externalSystem,
          externalId: args.externalId,
        },
      });
      return { taskId: existing._id, created: false };
    }

    const status: Doc<'tasks'>['status'] =
      args.externalState === 'closed' ? 'done' : SYNC_OPEN_STATUS;
    const rank = await computeEndRank(ctx, args.projectId, status);
    const number = await nextTaskNumber(ctx, project);
    const taskId = await ctx.db.insert('tasks', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      title,
      description,
      status,
      priority: args.priority,
      labels: args.labels,
      rank,
      number,
      externalSystem: args.externalSystem,
      externalId: args.externalId,
      externalUrl: args.externalUrl,
      completedAt: status === 'done' ? now : undefined,
      createdBy: args.actorId,
      createdByType: 'agent',
      createdAt: now,
      updatedAt: now,
    });
    const task = await ctx.db.get(taskId);
    if (task) {
      await recordActivity(ctx, {
        task,
        actorType: 'agent',
        actorId: args.actorId,
        action: 'created',
        toValue: status,
      });
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.created',
        eventData: { task },
      });
    }
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.created,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(taskId),
      resourceName: title,
      metadata: {
        projectId: String(args.projectId),
        externalSystem: args.externalSystem,
        externalId: args.externalId,
      },
    });
    return { taskId, created: true };
  },
});

export const agentUpdateTaskStatus = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    status: taskStatusValidator,
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    if (task.status === args.status) return { ok: true };
    if (
      TERMINAL_STATUSES.has(args.status) &&
      (await hasOpenChildren(ctx, args.taskId))
    ) {
      return { ok: false, reason: 'TASK_HAS_OPEN_SUBTASKS' };
    }

    const now = Date.now();
    const rank = await computeEndRank(ctx, task.projectId, args.status);
    await ctx.db.patch(args.taskId, {
      status: args.status,
      rank,
      // Preserve the original completion time on a re-close (mirrors moveTask).
      completedAt: TERMINAL_STATUSES.has(args.status)
        ? (task.completedAt ?? now)
        : undefined,
      updatedAt: now,
    });
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.actorId,
      action: 'status.changed',
      fromValue: task.status,
      toValue: args.status,
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.statusChanged,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
      metadata: { fromStatus: task.status, toStatus: args.status },
    });
    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await notifyTaskStatusChanged(ctx, {
        task: updated,
        fromStatus: task.status,
        toStatus: args.status,
        actorType: 'agent',
        actorId: args.actorId,
      });
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.status_changed',
        eventData: {
          task: updated,
          fromStatus: task.status,
          toStatus: args.status,
        },
      });
    }
    return { ok: true };
  },
});

export const agentClaimTask = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ claimed: boolean; reason?: string }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    if (!canClaimTask(task)) {
      return { claimed: false, reason: 'ALREADY_CLAIMED' };
    }
    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      assigneeType: 'agent',
      assigneeId: args.actorId,
      claimedAt: now,
      updatedAt: now,
    });
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.actorId,
      action: 'claimed',
      toValue: args.actorId,
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.claimed,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
    });
    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.assigned',
        eventData: {
          task: updated,
          assigneeType: 'agent',
          assigneeId: args.actorId,
          previousAssigneeId: null,
        },
      });
    }
    return { claimed: true };
  },
});

export const agentAssignTask = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    assigneeType: v.optional(taskActorTypeValidator),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
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
      actorType: 'agent',
      actorId: args.actorId,
      action: 'assignee.changed',
      fromValue: previousAssigneeId ?? undefined,
      toValue: assignee?.assigneeId,
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: assignee
        ? TASK_AUDIT_ACTIONS.assigned
        : TASK_AUDIT_ACTIONS.unassigned,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
    });
    const updated = await ctx.db.get(args.taskId);
    if (updated) {
      await notifyTaskAssigned(ctx, {
        task: updated,
        assigneeType: assignee?.assigneeType ?? null,
        assigneeId: assignee?.assigneeId ?? null,
        actorType: 'agent',
        actorId: args.actorId,
      });
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'task.assigned',
        eventData: {
          task: updated,
          assigneeType: assignee?.assigneeType ?? null,
          assigneeId: assignee?.assigneeId ?? null,
          previousAssigneeId,
        },
      });
    }
    return { ok: true };
  },
});

export const agentAddComment = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<{ commentId: Id<'taskComments'> }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    const project = await loadProjectInOrg(
      ctx,
      task.projectId,
      args.organizationId,
    );
    const body = args.body.trim();
    if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
      throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
    }
    const directory = await buildMentionDirectory(ctx, {
      organizationId: args.organizationId,
      project,
    });
    const mentions = extractMentions(body, directory);

    const now = Date.now();
    const commentId = await ctx.db.insert('taskComments', {
      organizationId: args.organizationId,
      taskId: args.taskId,
      projectId: task.projectId,
      authorType: 'agent',
      authorId: args.actorId,
      body,
      mentions: mentions.length > 0 ? mentions : undefined,
      createdAt: now,
      updatedAt: now,
    });
    // Keep the denormalized comment count in step (mirrors addTaskComment).
    await ctx.db.patch(args.taskId, {
      commentCount: (task.commentCount ?? 0) + 1,
    });
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.actorId,
      action: 'comment.added',
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.commentCreated,
      resourceType: TASK_COMMENT_RESOURCE_TYPE,
      resourceId: String(commentId),
      resourceName: task.title,
      metadata: { taskId: String(args.taskId), mentionCount: mentions.length },
    });
    await notifyTaskComment(ctx, {
      task,
      commentId,
      mentions,
      actorType: 'agent',
      actorId: args.actorId,
    });

    const comment = await ctx.db.get(commentId);
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'comment.created',
      eventData: { comment, taskId: String(args.taskId) },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'comment.mentioned',
        eventData: { comment, taskId: String(args.taskId), mentions },
      });
    }
    return { commentId };
  },
});

// ---------------------------------------------------------------------------
// Projects (agent create/update)
// ---------------------------------------------------------------------------

export const agentCreateProject = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ projectId: Id<'projects'> }> => {
    const name = args.name.trim();
    if (name.length === 0 || name.length > 80) {
      throw new ConvexError({ code: 'PROJECT_NAME_INVALID' });
    }
    const now = Date.now();
    const projectId = await ctx.db.insert('projects', {
      organizationId: args.organizationId,
      name,
      description: args.description?.trim() || undefined,
      instructions: args.instructions || undefined,
      createdBy: args.actorId,
      createdAt: now,
      updatedAt: now,
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: 'project.created',
      resourceType: 'project',
      resourceId: String(projectId),
      resourceName: name,
    });
    const project = await ctx.db.get(projectId);
    if (project) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'project.created',
        eventData: { project },
      });
    }
    return { projectId };
  },
});

export const agentUpdateProject = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    projectId: v.id('projects'),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    instructions: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const project = await loadProjectInOrg(
      ctx,
      args.projectId,
      args.organizationId,
    );
    const patch: Partial<Doc<'projects'>> = { updatedAt: Date.now() };
    const changedFields: string[] = [];
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0 || name.length > 80) {
        throw new ConvexError({ code: 'PROJECT_NAME_INVALID' });
      }
      patch.name = name;
      changedFields.push('name');
    }
    if (args.description !== undefined) {
      patch.description =
        args.description === null ? undefined : args.description.trim();
      changedFields.push('description');
    }
    if (args.instructions !== undefined) {
      patch.instructions =
        args.instructions === null ? undefined : args.instructions;
      changedFields.push('instructions');
    }
    if (changedFields.length === 0) return { ok: true };
    await ctx.db.patch(args.projectId, patch);
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: 'project.updated',
      resourceType: 'project',
      resourceId: String(args.projectId),
      resourceName: patch.name ?? project.name,
      metadata: { changedFields },
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * One-off backfill: recompute `tasks.commentCount` from the live (non-deleted)
 * comment set for every task in an organization. Run after deploying the
 * comment-count denormalization so tasks created before counting reflect their
 * real count. Idempotent — only patches rows whose stored value has drifted.
 */
export const backfillTaskCommentCounts = internalMutation({
  args: { organizationId: v.string() },
  returns: v.object({ scanned: v.number(), updated: v.number() }),
  handler: async (ctx, args) => {
    let scanned = 0;
    let updated = 0;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      scanned += 1;
      let count = 0;
      for await (const comment of ctx.db
        .query('taskComments')
        .withIndex('by_task_createdAt', (q) => q.eq('taskId', task._id))) {
        if (!comment.deletedAt) count += 1;
      }
      if ((task.commentCount ?? 0) !== count) {
        await ctx.db.patch(task._id, { commentCount: count });
        updated += 1;
      }
    }
    return { scanned, updated };
  },
});
