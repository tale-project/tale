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

import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { DEFAULT_DISCUSSION_CATEGORY } from '../../lib/shared/constants/discussions';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskMentions,
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
  TASK_METRIC_ACTIONS,
  TASK_TITLE_MAX,
  TERMINAL_STATUSES,
} from './helpers';
import {
  extractMentions,
  parseMentionTokens,
  type ResolvedMention,
} from './mentions';
import {
  type CommentEventComment,
  taskActorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

/**
 * Actor attribution for task-domain events. Workflow-engine writes pass the
 * sentinel actorId 'workflow' (`task_action.ts::WORKFLOW_ACTOR_ID`); every
 * other caller of these internal mutations is an agent (actorId = slug).
 * Event subscribers use this to tell humans, agents, and the automation
 * engine apart — the foundation of the task-ops pack's loop prevention.
 */
function eventActor(actorId: string): {
  actorType: 'agent' | 'workflow';
  actorId: string;
} {
  return {
    actorType: actorId === 'workflow' ? 'workflow' : 'agent',
    actorId,
  };
}

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
      // Workforce loop-safety invariant (v): decomposition depth = 1. Agents
      // and automations may create subtasks of ROOT tasks only — a subtask
      // never gets agent-created children of its own, so manager decomposition
      // cannot recurse.
      if (parent.parentTaskId) {
        throw new ConvexError({ code: 'TASK_DEPTH_EXCEEDED' });
      }
    }

    const now = Date.now();
    const rank = await computeEndRank(ctx, args.projectId, status);
    const number = await nextTaskNumber(ctx, project);
    const description = args.description?.trim() || undefined;
    const taskId = await ctx.db.insert('tasks', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      title,
      description,
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
      statusChangedAt: now,
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
        eventData: { task, ...eventActor(args.actorId) },
      });
      // Description @mentions fan out like comment mentions (notify humans,
      // `task.mentioned` for the automation pack — whose workflow-actor guard
      // keeps engine-authored creates inert). External sync upserts
      // (`agentUpsertTaskByExternalRef`) deliberately do NOT do this: synced
      // bodies are full of foreign @handles that must never trigger anyone.
      if (description && parseMentionTokens(description).length > 0) {
        const directory = await buildMentionDirectory(ctx, {
          organizationId: args.organizationId,
          project,
        });
        const mentions = extractMentions(
          description,
          directory.entries,
          directory.permissiveAgents,
        );
        if (mentions.length > 0) {
          await notifyTaskMentions(ctx, {
            task,
            mentions,
            actorType: 'agent',
            actorId: args.actorId,
          });
          await emitEvent(ctx, {
            organizationId: args.organizationId,
            eventType: 'task.mentioned',
            eventData: {
              task,
              taskId: String(taskId),
              mentions,
              ...eventActor(args.actorId),
            },
          });
        }
      }
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
      if (statusFrom) {
        patch.statusChangedAt = now;
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
      statusChangedAt: now,
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
        eventData: { task, ...eventActor(args.actorId) },
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

    // HARD RULE (workforce invariant): agents never complete work. The only
    // automated path to 'done' is the review-gate workflow, which acts as the
    // 'workflow' actor after an explicit human approval. Everything an agent
    // produces parks at 'in_review' for that gate.
    if (args.status === 'done' && args.actorId !== 'workflow') {
      return { ok: false, reason: 'AGENTS_CANNOT_COMPLETE' };
    }

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
      statusChangedAt: now,
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
          ...eventActor(args.actorId),
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
          ...eventActor(args.actorId),
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
          ...eventActor(args.actorId),
        },
      });
    }
    return { ok: true };
  },
});

/**
 * Get-or-create the task's UNIFIED comment thread: a `kind:'task_discussion'`
 * chat thread whose messages ARE the task's comments. Atomic within the calling
 * mutation (a concurrent creator's transaction retries and re-reads
 * `tasks.discussionThreadId`), mirroring `ensureTaskThread`. DISTINCT from
 * `ensureTaskThread` (the private agent working/run thread — reusing it would
 * leak run prompts into the visible discussion). Plain in-txn helper so the
 * comment writers (which are mutations, not actions) can call it directly.
 */
async function ensureTaskDiscussionThread(
  ctx: MutationCtx,
  task: Doc<'tasks'>,
  organizationId: string,
): Promise<{ threadId: string; isNew: boolean }> {
  if (task.discussionThreadId) {
    const existing = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: task.discussionThreadId,
    });
    if (existing?.status === 'active') {
      return { threadId: task.discussionThreadId, isNew: false };
    }
    // Archived/deleted thread — fall through and mint a fresh one.
  }
  const project = await ctx.db.get(task.projectId);
  const identifier =
    project?.key && task.number !== undefined
      ? `${project.key}-${task.number}`
      : String(task._id);
  const threadId = await createThread(ctx, components.agent, {
    userId: task.createdBy,
    title: `task-discussion:${identifier}`,
    summary: JSON.stringify({
      kind: 'task_discussion',
      taskId: String(task._id),
      organizationId,
    }),
  });
  const now = Date.now();
  await ctx.db.insert('threadMetadata', {
    threadId,
    userId: task.createdBy,
    chatType: 'general',
    status: 'active',
    kind: 'task_discussion',
    taskId: task._id,
    projectId: task.projectId,
    organizationId,
    title: task.title,
    discussionStatus: 'open',
    discussionCategory: DEFAULT_DISCUSSION_CATEGORY,
    createdAt: now,
    updatedAt: now,
    lastReplyAt: now,
    generationStatus: 'idle',
    agentReplyDepth: 0,
  });
  await ctx.db.patch(task._id, { discussionThreadId: threadId });
  return { threadId, isNew: true };
}

/**
 * THE single write path for a task comment: ensure the task's discussion
 * thread, persist the comment as a message in the `@convex-dev/agent` store,
 * and write its side-car meta row in LOCKSTEP (same txn). Humans post as
 * `role:'user'`; agents AND the workflow actor post as `role:'assistant'`
 * (so MessageBubble renders them on the agent side, matching discussions).
 *
 * ATOMIC INVARIANT: no other code may `saveMessage` into a task_discussion
 * thread — author/`editedAt`/`mentions` live ONLY in the meta row written here,
 * so a message without its meta would render unattributed and be uneditable.
 */
export async function postTaskDiscussionMessage(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    task: Doc<'tasks'>;
    project: Doc<'projects'>;
    actorType: 'user' | 'agent';
    actorId: string;
    body: string;
  },
): Promise<{
  messageId: string;
  threadId: string;
  mentions: ResolvedMention[];
}> {
  const { threadId } = await ensureTaskDiscussionThread(
    ctx,
    args.task,
    args.organizationId,
  );
  const directory = await buildMentionDirectory(ctx, {
    organizationId: args.organizationId,
    project: args.project,
  });
  const mentions = extractMentions(
    args.body,
    directory.entries,
    directory.permissiveAgents,
  );
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId,
    message: {
      role: args.actorType === 'user' ? 'user' : 'assistant',
      content: args.body,
    },
    ...(args.actorType === 'user' ? { userId: args.actorId } : {}),
  });
  await ctx.db.insert('taskDiscussionMessageMeta', {
    organizationId: args.organizationId,
    threadId,
    taskId: args.task._id,
    messageId,
    authorType: args.actorType,
    authorId: args.actorId,
    mentions: mentions.length > 0 ? mentions : undefined,
    createdAt: Date.now(),
  });
  return { messageId, threadId, mentions };
}

export const agentAddComment = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    body: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ messageId: string; threadId: string; mentionCount: number }> => {
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

    // Unified surface: the comment is a message in the task's discussion
    // thread, with its author/mentions in the lockstep meta row.
    const { messageId, threadId, mentions } = await postTaskDiscussionMessage(
      ctx,
      {
        organizationId: args.organizationId,
        task,
        project,
        actorType: 'agent',
        actorId: args.actorId,
        body,
      },
    );
    // Denormalized count — CRITICAL for the board comment indicator.
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
      resourceId: messageId,
      resourceName: task.title,
      metadata: { taskId: String(args.taskId), mentionCount: mentions.length },
    });
    // `postTaskDiscussionMessage` does NOT fan out notifications — keep the
    // follower/mention notification here (the discussion path lacks it).
    await notifyTaskComment(ctx, {
      task,
      commentId: messageId,
      mentions,
      actorType: 'agent',
      actorId: args.actorId,
    });

    // No `taskComments` doc exists anymore — RECONSTRUCT the event `comment`
    // object to the exact shape the task-ops pack reads (`input.comment.body`)
    // and `comment.*` event filters resolve (`comment.projectId`).
    const comment: CommentEventComment = {
      body,
      projectId: String(task.projectId),
      taskId: String(args.taskId),
      mentions,
    };
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'comment.created',
      eventData: {
        comment,
        taskId: String(args.taskId),
        ...eventActor(args.actorId),
      },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'comment.mentioned',
        eventData: {
          comment,
          taskId: String(args.taskId),
          mentions,
          ...eventActor(args.actorId),
        },
      });
    }
    // `mentionCount` lets callers detect a mention that did NOT resolve
    // against the project directory (the escalation tool's fallback signal).
    return { messageId, threadId, mentionCount: mentions.length };
  },
});

/**
 * Escalation entry point for the `escalate` agent tool (task context):
 * posts an agent-authored `@manager [escalation]` comment — which the
 * mention-response workflow turns into a manager run under the MANAGER's
 * own guardrails — and records the `agent.escalated` metric activity.
 * `mentionResolved: false` (manager not mentionable in this project, or no
 * manager at all) tells the tool to fall back to notifying humans.
 */
export const agentEscalateOnTask = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    managerSlug: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    messageId: v.optional(v.string()),
    mentionResolved: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    messageId?: string;
    mentionResolved: boolean;
  }> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) {
      return { ok: false, mentionResolved: false };
    }
    const reason = args.reason.trim().slice(0, 2000);
    const body = args.managerSlug
      ? `@${args.managerSlug} [escalation] ${reason}`
      : `[escalation] ${reason}`;
    const { messageId, mentionCount } = await ctx.runMutation(
      internal.tasks.internal_mutations.agentAddComment,
      {
        organizationId: args.organizationId,
        actorId: args.actorId,
        taskId: args.taskId,
        body,
      },
    );
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.actorId,
      action: TASK_METRIC_ACTIONS.agentEscalated,
      toValue: args.managerSlug ?? 'humans',
    });
    return {
      ok: true,
      messageId,
      mentionResolved: args.managerSlug !== undefined && mentionCount > 0,
    };
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
      // Comments are now `task_discussion` messages, 1:1 with their meta rows.
      let count = 0;
      for await (const _meta of ctx.db
        .query('taskDiscussionMessageMeta')
        .withIndex('by_task', (q) => q.eq('taskId', task._id))) {
        count += 1;
      }
      if ((task.commentCount ?? 0) !== count) {
        await ctx.db.patch(task._id, { commentCount: count });
        updated += 1;
      }
    }
    return { scanned, updated };
  },
});

// ---------------------------------------------------------------------------
// Per-task agent thread
// ---------------------------------------------------------------------------

/**
 * Get-or-create the dedicated agent working thread for a task. Revision and
 * mention runs share it so context accumulates across runs. Atomic within
 * this mutation (a concurrent creator's transaction retries and re-reads
 * `tasks.threadId`), mirroring `getOrCreateSubThreadAtomic`.
 */
export const ensureTaskThread = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
  },
  returns: v.object({ threadId: v.string(), isNew: v.boolean() }),
  handler: async (ctx, args) => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);

    if (task.threadId) {
      const existing = await ctx.runQuery(components.agent.threads.getThread, {
        threadId: task.threadId,
      });
      if (existing?.status === 'active') {
        return { threadId: task.threadId, isNew: false };
      }
      // Archived/deleted thread — fall through and mint a fresh one.
    }

    const project = await ctx.db.get(task.projectId);
    const identifier =
      project?.key && task.number !== undefined
        ? `${project.key}-${task.number}`
        : String(args.taskId);
    const thread = await ctx.runMutation(
      components.agent.threads.createThread,
      {
        title: `task:${identifier}`,
        summary: JSON.stringify({
          taskThread: {
            taskId: String(args.taskId),
            organizationId: args.organizationId,
          },
        }),
      },
    );
    await ctx.db.patch(args.taskId, { threadId: thread._id });
    return { threadId: thread._id, isNew: true };
  },
});

// ---------------------------------------------------------------------------
// Sweeps (workflow `task.sweep` operations)
// ---------------------------------------------------------------------------

/**
 * Stale-work sweep: agent-assigned tasks sitting in `in_progress` with no
 * status movement for `staleAfterHours`. One-shot by construction — the
 * pack workflow's rollback to `todo` changes `statusChangedAt`, so a task
 * never matches twice without new activity. Bounded per call.
 */
export const sweepStaleTasks = internalMutation({
  args: {
    organizationId: v.string(),
    staleAfterHours: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      taskId: v.id('tasks'),
      title: v.string(),
      assigneeId: v.optional(v.string()),
      staleSinceMs: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const cutoff = Date.now() - args.staleAfterHours * 60 * 60 * 1000;
    const stale: Array<{
      taskId: Id<'tasks'>;
      title: string;
      assigneeId?: string;
      staleSinceMs: number;
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'in_progress'),
      )) {
      if (task.archivedAt) continue;
      if (task.assigneeType !== 'agent') continue;
      const lastMovement = task.statusChangedAt ?? task.updatedAt;
      if (lastMovement >= cutoff) continue;
      stale.push({
        taskId: task._id,
        title: task.title,
        assigneeId: task.assigneeId,
        staleSinceMs: lastMovement,
      });
      if (stale.length >= limit) break;
    }
    return stale;
  },
});

function clampSweepLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 100);
}

const sweepRowShape = {
  taskId: v.id('tasks'),
  projectId: v.id('projects'),
  title: v.string(),
  assigneeType: v.optional(taskActorTypeValidator),
  assigneeId: v.optional(v.string()),
  dueDate: v.number(),
  /** `projects.createdBy` — the level-4 escalation target. */
  projectCreatorId: v.optional(v.string()),
};

/** Memoized project lookup for sweep enrichment (one fetch per project per sweep). */
async function projectCreatorLookup(
  ctx: MutationCtx,
): Promise<(projectId: Id<'projects'>) => Promise<string | undefined>> {
  const cache = new Map<string, string | undefined>();
  return async (projectId: Id<'projects'>) => {
    const key = String(projectId);
    if (!cache.has(key)) {
      const project = await ctx.db.get(projectId);
      cache.set(key, project?.createdBy);
    }
    return cache.get(key);
  };
}

/**
 * Due-soon sweep (SLA level 1): open tasks whose due date falls inside the
 * warning window and that have never been warned. Atomic mark-and-return —
 * `slaLevel` is stamped in this mutation, so a task is returned exactly once
 * per ladder no matter how often the cron re-runs. Pushing the due date out
 * resets the ladder (`updateTask` clears `slaLevel` on due-date change).
 */
export const sweepDueSoonTasks = internalMutation({
  args: {
    organizationId: v.string(),
    windowHours: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object(sweepRowShape)),
  handler: async (ctx, args) => {
    const limit = clampSweepLimit(args.limit);
    const now = Date.now();
    const windowEnd = now + args.windowHours * 60 * 60 * 1000;
    const creatorOf = await projectCreatorLookup(ctx);

    const rows: Array<{
      taskId: Id<'tasks'>;
      projectId: Id<'projects'>;
      title: string;
      assigneeType?: 'user' | 'agent';
      assigneeId?: string;
      dueDate: number;
      projectCreatorId?: string;
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_dueDate', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gt('dueDate', now)
          .lte('dueDate', windowEnd),
      )) {
      if (task.archivedAt || TERMINAL_STATUSES.has(task.status)) continue;
      if ((task.slaLevel ?? 0) >= 1) continue;
      if (task.dueDate === undefined) continue;
      await ctx.db.patch(task._id, { slaLevel: 1, slaLevelAt: now });
      rows.push({
        taskId: task._id,
        projectId: task.projectId,
        title: task.title,
        assigneeType: task.assigneeType,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        projectCreatorId: await creatorOf(task.projectId),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
});

/**
 * Overdue escalation ladder (SLA levels 2–4): open tasks past their due date,
 * each stamped with the highest level its overdue age has reached —
 * 2 = nudge comment, 3 = manager escalation, 4 = owner/admin escalation.
 * Monotonic mark-and-return: a task is returned at most once per level, and
 * a long-overdue task skips straight to the highest applicable level (one
 * action, not three). Level-3 manager resolution happens in the action layer
 * (the org chart lives in agent files, unreadable from a mutation).
 */
export const sweepOverdueLadder = internalMutation({
  args: {
    organizationId: v.string(),
    managerEscalationHours: v.number(),
    adminEscalationHours: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({ ...sweepRowShape, newLevel: v.number() })),
  handler: async (ctx, args) => {
    const limit = clampSweepLimit(args.limit);
    const now = Date.now();
    const managerMs = args.managerEscalationHours * 60 * 60 * 1000;
    const adminMs = args.adminEscalationHours * 60 * 60 * 1000;
    const creatorOf = await projectCreatorLookup(ctx);

    const rows: Array<{
      taskId: Id<'tasks'>;
      projectId: Id<'projects'>;
      title: string;
      assigneeType?: 'user' | 'agent';
      assigneeId?: string;
      dueDate: number;
      projectCreatorId?: string;
      newLevel: number;
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_org_dueDate', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gt('dueDate', 0)
          .lte('dueDate', now),
      )) {
      if (task.archivedAt || TERMINAL_STATUSES.has(task.status)) continue;
      if (task.dueDate === undefined) continue;
      const overdueMs = now - task.dueDate;
      const targetLevel =
        overdueMs >= adminMs ? 4 : overdueMs >= managerMs ? 3 : 2;
      if (targetLevel <= (task.slaLevel ?? 0)) continue;
      await ctx.db.patch(task._id, { slaLevel: targetLevel, slaLevelAt: now });
      rows.push({
        taskId: task._id,
        projectId: task.projectId,
        title: task.title,
        assigneeType: task.assigneeType,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        projectCreatorId: await creatorOf(task.projectId),
        newLevel: targetLevel,
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
});

/**
 * Archivable sweep: terminal (done/cancelled) tasks closed longer than
 * `olderThanDays` ago. Read-only — the archive itself goes through
 * `agentArchiveTask`, which re-checks the status (a human may have reopened
 * the task between sweep and archive). Archived rows drop out of the scan,
 * so the pair is one-shot without any stamping.
 */
export const sweepArchivableTasks = internalMutation({
  args: {
    organizationId: v.string(),
    olderThanDays: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({ taskId: v.id('tasks'), title: v.string() })),
  handler: async (ctx, args) => {
    const limit = clampSweepLimit(args.limit);
    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const rows: Array<{ taskId: Id<'tasks'>; title: string }> = [];
    for (const status of ['done', 'cancelled'] as const) {
      for await (const task of ctx.db
        .query('tasks')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        if (task.archivedAt) continue;
        const closedAt =
          task.completedAt ?? task.statusChangedAt ?? task.updatedAt;
        if (closedAt >= cutoff) continue;
        rows.push({ taskId: task._id, title: task.title });
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  },
});

/**
 * Archive a TERMINAL task on behalf of an automation. Emits NO event — the
 * loop-safe terminal operation of the pack (auto-archive must never wake
 * other workflows). Refuses non-terminal tasks: the TOCTOU guard for the
 * sweep→archive pair.
 */
export const agentArchiveTask = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
  },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    if (task.archivedAt) return { ok: true };
    if (!TERMINAL_STATUSES.has(task.status)) {
      return { ok: false, reason: 'TASK_NOT_TERMINAL' };
    }
    const now = Date.now();
    await ctx.db.patch(args.taskId, { archivedAt: now, updatedAt: now });
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.actorId,
      action: 'archived',
    });
    await agentAudit(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      action: TASK_AUDIT_ACTIONS.archived,
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.taskId),
      resourceName: task.title,
    });
    return { ok: true };
  },
});
