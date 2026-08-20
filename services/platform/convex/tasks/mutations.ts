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

import { defaultTaskLabelColor } from '../../lib/shared/task-label-colors';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from '../_generated/server';
import { assertAgentAssigneeLive } from '../agents/installations';
import { recordTaskAgentRunLedgerEntry } from '../audit_logs/agent_run_ledger';
import { createAuditLog } from '../audit_logs/helpers';
import { findLiveAutomationRunForTask } from '../automations/queries';
import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import {
  autoSubscribe,
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskMentions,
  notifyTaskStatusChanged,
} from '../collab/notify';
import { resolveSurfaceMentions } from '../collab/resolve_surface_mentions';
import { cascadeDeleteThreadChildren } from '../discussions/thread_cascade';
import { emitEvent } from '../events/emit';
import { deleteStorageWithMetadata } from '../file_metadata/helpers';
import { getUserTeamIds } from '../lib/get_user_teams';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  agentAssigneeInProject,
  assertAgentAssigneeInProject,
  assertHumanAssigneeAccess,
  resolveUserAccessContext,
} from '../projects/resolve_project_access';
import { agentWorkTurnDeadlineMs } from '../sandbox/agent_deadline';
import { sessionIdForProjectAgent } from '../sandbox/session_naming';
import {
  canClaimTask,
  checkProjectAccess,
  hasProjectAccess,
  normalizeAssignee,
} from './access';
import { resolveTaskKickStartArgs } from './agent_runs';
import {
  cleanupRemovedAttachments,
  validateTaskAttachments,
} from './attachments';
import {
  TASK_AUDIT_ACTIONS,
  TASK_COMMENT_RESOURCE_TYPE,
  TASK_RESOURCE_TYPE,
} from './audit_actions';
import { type DependencyEdge, wouldCreateCycle } from './dependencies';
import { buildMentionDirectory } from './directory';
import {
  computeEndRank,
  countTaskCreated,
  countTaskDeleted,
  countTaskStateChanged,
  ensureDefaultProjectLabels,
  hasOpenChildren,
  isScheduleOrderValid,
  nextTaskNumber,
  normalizeLabelNames,
  recordActivity,
  resolveProjectLabels,
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  TERMINAL_STATUSES,
} from './helpers';
import { postTaskDiscussionMessage } from './internal_mutations';
import {
  addedMentions,
  extractMentions,
  parseMentionTokens,
  resolveMentions,
  type ResolvedMention,
} from './mentions';
import { rankBetween } from './rank';
import { requestTaskReview } from './review_shared';
import {
  boardViewFiltersValidator,
  boardViewTypeValidator,
  boardViewScopeValidator,
  type CommentEventComment,
  taskAssigneeTypeValidator,
  taskAttachmentValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

const BULK_UPDATE_MAX = 100;

// Upper bound on dependency edges scanned per project when checking for cycles.
// Mirrors the board's bounded-scan posture (`TASK_BOARD_CAP`); a project with
// more edges than this is already pathological.
const TASK_DEPENDENCIES_CAP = 5000;

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
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

  const member = await getOrganizationMember(ctx, organizationId, authUser);
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

/**
 * An archived task is read-only: only archive/restore may touch it. Guards the
 * content-edit mutations so a stale tab (or a bulk op) can't mutate an archived
 * row server-side, matching the UI's `canMutate = canEdit && !isArchived` gate.
 */
function assertTaskNotArchived(task: Doc<'tasks'>): void {
  if (task.archivedAt !== undefined)
    throw new ConvexError({ code: 'TASK_ARCHIVED' });
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

/** Reject when both schedule bounds are set and start is after due. */
function assertScheduleOrder(
  startDate: number | undefined,
  dueDate: number | undefined,
): void {
  if (!isScheduleOrderValid(startDate, dueDate)) {
    throw new ConvexError({ code: 'TASK_SCHEDULE_INVALID' });
  }
}

/**
 * Fan-out for `@mentions` in a task DESCRIPTION — the description-side mirror
 * of the comment mention pipeline: subscribe + notify mentioned humans
 * (`notifyTaskMentions`), then emit `task.mentioned` so the mention-response
 * automation can put mentioned agents to work once the automations rewrite
 * lands (the event seam is the single dispatch route; the old
 * workflow-engine direct-dispatch fallback died with its tables). Callers
 * pass only the mentions the write NEWLY introduced (see `addedMentions`).
 */
async function fanOutDescriptionMentions(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    mentions: ResolvedMention[];
    actorId: string;
  },
): Promise<void> {
  if (args.mentions.length === 0) return;
  await notifyTaskMentions(ctx, {
    task: args.task,
    mentions: args.mentions,
    actorType: 'user',
    actorId: args.actorId,
  });
  await emitEvent(ctx, {
    organizationId: args.task.organizationId,
    eventType: 'task.mentioned',
    eventData: {
      task: args.task,
      taskId: String(args.task._id),
      mentions: args.mentions,
      actorType: 'user',
      actorId: args.actorId,
    },
  });
}

/**
 * Fan-out for NEWLY added `@mentions` on a task COMMENT edit — mirrors
 * `addTaskComment`'s mention half (`notifyTaskComment` + `comment.mentioned`)
 * without re-alerting subscribers as if a fresh comment were posted, and
 * without emitting `comment.created`. Callers pass only `addedMentions(...)`.
 */
async function fanOutCommentEditMentions(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    commentId: string;
    body: string;
    mentions: ResolvedMention[];
    actorId: string;
  },
): Promise<void> {
  if (args.mentions.length === 0) return;
  await notifyTaskComment(ctx, {
    task: args.task,
    commentId: args.commentId,
    mentions: args.mentions,
    actorType: 'user',
    actorId: args.actorId,
    notifySubscribers: false,
  });
  const comment: CommentEventComment = {
    body: args.body,
    projectId: String(args.task.projectId),
    taskId: String(args.task._id),
    mentions: args.mentions,
  };
  await emitEvent(ctx, {
    organizationId: args.task.organizationId,
    eventType: 'comment.mentioned',
    eventData: {
      comment,
      taskId: String(args.task._id),
      mentions: args.mentions,
      actorType: 'user',
      actorId: args.actorId,
    },
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** An automation assignee must NAME a deployed automation — `assigneeId` is
 * the store name; a typo would otherwise create a task nothing operates. */
async function assertAutomationAssigneeDeployed(
  ctx: MutationCtx,
  organizationId: string,
  name: string,
): Promise<void> {
  const deployment = await ctx.db
    .query('automationDeployments')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .unique();
  if (!deployment) {
    throw new ConvexError({
      code: 'TASK_ASSIGNEE_INVALID',
      message: `No deployed automation named "${name}" in this organization`,
    });
  }
}

export const createTask = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
    attachments: v.optional(v.array(taskAttachmentValidator)),
    status: v.optional(taskStatusValidator),
    priority: v.optional(taskPriorityValidator),
    labels: v.optional(v.array(v.string())),
    assigneeType: v.optional(taskAssigneeTypeValidator),
    assigneeId: v.optional(v.string()),
    parentTaskId: v.optional(v.id('tasks')),
    startDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
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
    const labelIds = await resolveProjectLabels(ctx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      names: args.labels,
      createdBy: auth.userId,
    });
    assertScheduleOrder(args.startDate, args.dueDate);
    const attachments = await validateTaskAttachments(
      ctx,
      args.organizationId,
      args.attachments,
    );
    const status = args.status ?? 'backlog';
    const assignee = normalizeAssignee({
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
    });
    await assertAgentAssigneeLive(ctx, args.organizationId, assignee);
    if (assignee?.assigneeType === 'user') {
      await assertHumanAssigneeAccess(ctx, {
        project,
        organizationId: args.organizationId,
        assigneeId: assignee.assigneeId,
        callerId: auth.userId,
      });
    } else if (assignee?.assigneeType === 'agent') {
      await assertAgentAssigneeInProject(
        ctx,
        args.projectId,
        assignee.assigneeId,
      );
    } else if (assignee?.assigneeType === 'app') {
      await assertAutomationAssigneeDeployed(
        ctx,
        project.organizationId,
        assignee.assigneeId,
      );
    }

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
      attachments,
      status,
      priority: args.priority,
      labelIds,
      assigneeType: assignee?.assigneeType,
      assigneeId: assignee?.assigneeId,
      parentTaskId: args.parentTaskId,
      startDate: args.startDate,
      dueDate: args.dueDate,
      rank,
      number,
      createdBy: auth.userId,
      createdByType: 'user',
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
    });
    await countTaskCreated(ctx, args.projectId, {
      status,
      archivedAt: undefined,
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
        eventData: { task, actorType: 'user', actorId: auth.userId },
      });
      // @mentions in the description work like comment mentions. The token
      // pre-check keeps the (org-wide) directory build off the common path.
      if (description && parseMentionTokens(description).length > 0) {
        const directory = await buildMentionDirectory(ctx, {
          organizationId: args.organizationId,
          project,
        });
        await fanOutDescriptionMentions(ctx, {
          task,
          mentions: extractMentions(
            description,
            directory.entries,
            directory.permissiveAgents,
          ),
          actorId: auth.userId,
        });
      }
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
    attachments: v.optional(v.array(taskAttachmentValidator)),
    priority: v.optional(v.union(taskPriorityValidator, v.null())),
    labels: v.optional(v.array(v.string())),
    startDate: v.optional(v.union(v.number(), v.null())),
    dueDate: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);
    assertTaskNotArchived(task);

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
      // Explicit [] clears. Names must already exist in the project catalog —
      // unknown ones throw TASK_LABEL_UNKNOWN rather than minting a row, so a
      // typo in the picker can't silently grow the catalog.
      patch.labelIds = await resolveProjectLabels(ctx, {
        organizationId: task.organizationId,
        projectId: task.projectId,
        names: args.labels,
        createdBy: auth.userId,
      });
      // Drop any legacy string array left mid-migration.
      patch.labels = undefined;
      changedFields.push('labels');
    }
    if (args.attachments !== undefined) {
      patch.attachments = await validateTaskAttachments(
        ctx,
        task.organizationId,
        args.attachments,
      );
      changedFields.push('attachments');
    }
    if (args.startDate !== undefined) {
      patch.startDate = args.startDate === null ? undefined : args.startDate;
      // Any start-date change restarts the start-reached notification: clearing
      // or moving the date means a prior stamp no longer describes this task.
      patch.startNotifiedAt = undefined;
      changedFields.push('startDate');
    }
    if (args.dueDate !== undefined) {
      patch.dueDate = args.dueDate === null ? undefined : args.dueDate;
      // Any deadline change restarts the SLA escalation ladder: clearing the
      // date or moving it means prior due-soon/overdue escalations no longer
      // describe this task. The sweep re-stamps from level 1 as it re-applies.
      patch.slaLevel = undefined;
      patch.slaLevelAt = undefined;
      changedFields.push('dueDate');
    }

    if (changedFields.length === 0) return null;

    const nextStart =
      args.startDate !== undefined
        ? args.startDate === null
          ? undefined
          : args.startDate
        : task.startDate;
    const nextDue =
      args.dueDate !== undefined
        ? args.dueDate === null
          ? undefined
          : args.dueDate
        : task.dueDate;
    assertScheduleOrder(nextStart, nextDue);

    await ctx.db.patch(args.taskId, patch);

    // Purge storage for any attachment the edit dropped (full-replace ⇒ the
    // diff against the prior set is what was removed). Runs after the patch so
    // the row already reflects the new set if a later step throws.
    if (args.attachments !== undefined) {
      await cleanupRemovedAttachments(ctx, task.attachments, patch.attachments);
    }

    // A description edit fans out its NEWLY added @mentions only — reworded
    // prose around an existing mention must not re-notify or re-trigger.
    const nextDescription = patch.description ?? '';
    if (
      changedFields.includes('description') &&
      parseMentionTokens(nextDescription).length > 0
    ) {
      const directory = await buildMentionDirectory(ctx, {
        organizationId: task.organizationId,
        project,
      });
      const mentions = addedMentions(
        extractMentions(
          task.description ?? '',
          directory.entries,
          directory.permissiveAgents,
        ),
        resolveMentions(
          parseMentionTokens(nextDescription),
          directory.entries,
          directory.permissiveAgents,
        ),
      );
      const updated = await ctx.db.get(args.taskId);
      if (updated) {
        await fanOutDescriptionMentions(ctx, {
          task: updated,
          mentions,
          actorId: auth.userId,
        });
      }
    }

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
    assertTaskNotArchived(task);

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
      statusChangedAt: now,
      // A HUMAN status change resets the agent-run circuit breaker — the
      // explicit "human action resumes automation" contract of the guardrails.
      agentRunsPausedAt: undefined,
      agentRunsPausedReason: undefined,
    });
    await countTaskStateChanged(ctx, task.projectId, task, {
      status: args.status,
      archivedAt: task.archivedAt,
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
          actorType: 'user',
          actorId: auth.userId,
        },
      });
      // Reaching `in_review` IS the request for review, whoever submitted —
      // the gate belongs to the STATE, not to the agent lane. Same transaction
      // as the flip, so a card in In review always has a gate behind it.
      if (args.status === 'in_review') {
        await requestTaskReview(ctx, {
          task: updated,
          trigger: { kind: 'human', actorId: auth.userId },
        });
      }
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Assign / unassign (set or clear the polymorphic single assignee)
// ---------------------------------------------------------------------------

/**
 * The validated core of an assignee change — live-run guard, patch, activity,
 * audit, notify, event — shared by `assignTask` and the comment @mention
 * trigger. The caller has already authorized the write and validated the
 * assignee ref; this enforces only the cross-engine invariant: ownership
 * never transfers while ANY engine is live on the task.
 */
async function applyAssigneeChange(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    auth: { userId: string; email?: string };
    assignee: {
      assigneeType: 'user' | 'agent' | 'app';
      assigneeId: string;
    } | null;
  },
): Promise<void> {
  const { task, auth, assignee } = args;
  const assigneeChanges =
    (task.assigneeType ?? null) !== (assignee?.assigneeType ?? null) ||
    (task.assigneeId ?? null) !== (assignee?.assigneeId ?? null);
  if (assigneeChanges) {
    const liveRun =
      (await liveTaskAgentRun(ctx, task._id)) ??
      (await findLiveAutomationRunForTask(ctx, {
        organizationId: task.organizationId,
        projectId: task.projectId,
        taskId: task._id,
      }));
    if (liveRun !== null) {
      throw new ConvexError({ code: 'TASK_HAS_LIVE_RUN' });
    }
  }
  const previousAssigneeId = task.assigneeId ?? null;

  await ctx.db.patch(task._id, {
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
    resourceId: String(task._id),
    resourceName: task.title,
    previousState: { assigneeId: previousAssigneeId },
    newState: { assigneeId: assignee?.assigneeId ?? null },
    status: 'success',
  });

  const updated = await ctx.db.get(task._id);
  if (updated) {
    await notifyTaskAssigned(ctx, {
      task: updated,
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: assignee?.assigneeId ?? null,
      actorType: 'user',
      actorId: auth.userId,
      ...(task.assigneeType !== undefined
        ? { previousAssigneeType: task.assigneeType }
        : {}),
      ...(previousAssigneeId !== null ? { previousAssigneeId } : {}),
    });
    await emitEvent(ctx, {
      organizationId: task.organizationId,
      eventType: 'task.assigned',
      eventData: {
        task: updated,
        assigneeType: assignee?.assigneeType ?? null,
        assigneeId: assignee?.assigneeId ?? null,
        previousAssigneeId,
        actorType: 'user',
        actorId: auth.userId,
      },
    });
  }
}

export const assignTask = mutation({
  args: {
    taskId: v.id('tasks'),
    assigneeType: v.optional(taskAssigneeTypeValidator),
    assigneeId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);
    assertTaskNotArchived(task);

    const assignee = normalizeAssignee({
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
    });
    await assertAgentAssigneeLive(ctx, task.organizationId, assignee);
    if (assignee?.assigneeType === 'user') {
      await assertHumanAssigneeAccess(ctx, {
        project,
        organizationId: task.organizationId,
        assigneeId: assignee.assigneeId,
        callerId: auth.userId,
      });
    } else if (assignee?.assigneeType === 'agent') {
      await assertAgentAssigneeInProject(
        ctx,
        task.projectId,
        assignee.assigneeId,
      );
    } else if (assignee?.assigneeType === 'app') {
      await assertAutomationAssigneeDeployed(
        ctx,
        project.organizationId,
        assignee.assigneeId,
      );
    }
    // Ownership transfer is refused while ANY engine is live on the task — a
    // reassign under a live run would leave that run driving a task another
    // worker now owns, or start a second engine over the same subject. The
    // UI offers cancel-then-reassign; applyAssigneeChange holds the invariant.
    await applyAssigneeChange(ctx, { task, auth, assignee });

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
          actorType: 'user',
          actorId: auth.userId,
        },
      });
    }

    return { claimed: true };
  },
});

// ---------------------------------------------------------------------------
// Dependencies (soft "blocked by" / "blocks" links between sibling tasks)
// ---------------------------------------------------------------------------

/** Load every dependency edge in a project (bounded), for cycle detection. */
async function loadProjectDependencyEdges(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
): Promise<DependencyEdge[]> {
  const edges: DependencyEdge[] = [];
  for await (const edge of ctx.db
    .query('taskDependencies')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
    edges.push({
      blockerTaskId: String(edge.blockerTaskId),
      blockedTaskId: String(edge.blockedTaskId),
    });
    if (edges.length >= TASK_DEPENDENCIES_CAP) break;
  }
  return edges;
}

/**
 * Link two tasks so `blockerTaskId` blocks `blockedTaskId`. Both must live in
 * the same project the caller can edit. Idempotent (a duplicate edge is a
 * no-op) and cycle-safe (rejects an edge that would close a loop). The link is
 * advisory — it never gates a status change.
 */
export const addTaskDependency = mutation({
  args: {
    blockerTaskId: v.id('tasks'),
    blockedTaskId: v.id('tasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.blockerTaskId === args.blockedTaskId) {
      throw new ConvexError({ code: 'TASK_DEPENDENCY_SELF' });
    }
    const blocked = await loadTaskOrThrow(ctx, args.blockedTaskId);
    const blocker = await loadTaskOrThrow(ctx, args.blockerTaskId);
    const project = await loadProjectOrThrow(ctx, blocked.projectId);
    const auth = await getAuthContext(ctx, blocked.organizationId);
    assertTaskWritable(project, auth);

    if (blocker.projectId !== blocked.projectId) {
      throw new ConvexError({ code: 'TASK_DEPENDENCY_PROJECT_MISMATCH' });
    }

    const existing = await ctx.db
      .query('taskDependencies')
      .withIndex('by_edge', (q) =>
        q
          .eq('blockerTaskId', args.blockerTaskId)
          .eq('blockedTaskId', args.blockedTaskId),
      )
      .first();
    if (existing) return null;

    const edges = await loadProjectDependencyEdges(ctx, blocked.projectId);
    if (
      wouldCreateCycle(
        edges,
        String(args.blockerTaskId),
        String(args.blockedTaskId),
      )
    ) {
      throw new ConvexError({ code: 'TASK_DEPENDENCY_CYCLE' });
    }

    const now = Date.now();
    await ctx.db.insert('taskDependencies', {
      organizationId: blocked.organizationId,
      projectId: blocked.projectId,
      blockerTaskId: args.blockerTaskId,
      blockedTaskId: args.blockedTaskId,
      createdBy: auth.userId,
      createdByType: 'user',
      createdAt: now,
    });
    // Bump the blocked task so the board's updatedAt-ordered reads refresh.
    await ctx.db.patch(args.blockedTaskId, { updatedAt: now });

    await recordActivity(ctx, {
      task: blocked,
      actorType: 'user',
      actorId: auth.userId,
      action: 'dependency.added',
      toValue: blocker.title,
    });
    await createAuditLog(ctx, {
      organizationId: blocked.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.dependencyAdded,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.blockedTaskId),
      resourceName: blocked.title,
      metadata: { blockerTaskId: String(args.blockerTaskId) },
      status: 'success',
    });
    return null;
  },
});

/** Remove a `blockerTaskId → blockedTaskId` dependency edge (no-op if absent). */
export const removeTaskDependency = mutation({
  args: {
    blockerTaskId: v.id('tasks'),
    blockedTaskId: v.id('tasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const blocked = await loadTaskOrThrow(ctx, args.blockedTaskId);
    const project = await loadProjectOrThrow(ctx, blocked.projectId);
    const auth = await getAuthContext(ctx, blocked.organizationId);
    assertTaskWritable(project, auth);

    const edge = await ctx.db
      .query('taskDependencies')
      .withIndex('by_edge', (q) =>
        q
          .eq('blockerTaskId', args.blockerTaskId)
          .eq('blockedTaskId', args.blockedTaskId),
      )
      .first();
    if (!edge) return null;

    const blocker = await ctx.db.get(args.blockerTaskId);
    const now = Date.now();
    await ctx.db.delete(edge._id);
    await ctx.db.patch(args.blockedTaskId, { updatedAt: now });

    await recordActivity(ctx, {
      task: blocked,
      actorType: 'user',
      actorId: auth.userId,
      action: 'dependency.removed',
      toValue: blocker?.title,
    });
    await createAuditLog(ctx, {
      organizationId: blocked.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.dependencyRemoved,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: String(args.blockedTaskId),
      resourceName: blocked.title,
      metadata: { blockerTaskId: String(args.blockerTaskId) },
      status: 'success',
    });
    return null;
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
  // Returns the new message id AND the (lazily-created) discussion thread id —
  // the frontend bootstrap needs the threadId to resolve a previously-threadless
  // task without a read-after-write ordering hole.
  returns: v.object({
    messageId: v.string(),
    threadId: v.string(),
    unresolvedMentionTokens: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    messageId: string;
    threadId: string;
    unresolvedMentionTokens: string[];
  }> => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    // Commenting is a READ-level action on the unified task_discussion surface:
    // any org member who can read the task may post, exactly like a project
    // discussion reply (`discussions/postReply` + `can_access_thread`'s
    // discussion branch). Gating this on write access (editor+) locked plain
    // members — including a task's own assignee — out of collaboration (#2339).
    assertTaskReadable(project, auth);

    const body = args.body.trim();
    if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
      throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
    }

    try {
      await checkUserRateLimit(ctx, 'task:comment', auth.userId);
    } catch (error) {
      mapRateLimitError(error);
    }

    // Unified surface: persist the comment as a message in the task's
    // discussion thread (+ its lockstep author/mentions meta row).
    const { messageId, threadId, mentions } = await postTaskDiscussionMessage(
      ctx,
      {
        organizationId: task.organizationId,
        task,
        project,
        actorType: 'user',
        actorId: auth.userId,
        body,
      },
    );

    // Denormalized count — CRITICAL for the board comment indicator.
    await ctx.db.patch(args.taskId, {
      commentCount: (task.commentCount ?? 0) + 1,
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
      resourceId: messageId,
      resourceName: task.title,
      metadata: {
        taskId: String(args.taskId),
        mentionCount: mentions.length,
      },
      status: 'success',
    });

    await notifyTaskComment(ctx, {
      task,
      commentId: messageId,
      mentions,
      actorType: 'user',
      actorId: auth.userId,
    });

    // No `taskComments` doc exists — reconstruct the event `comment` to the
    // shape the task-ops pack reads (`input.comment.body` + `comment.projectId`).
    const comment: CommentEventComment = {
      body,
      projectId: String(task.projectId),
      taskId: String(args.taskId),
      mentions,
    };
    await emitEvent(ctx, {
      organizationId: task.organizationId,
      eventType: 'comment.created',
      eventData: {
        comment,
        taskId: String(args.taskId),
        actorType: 'user',
        actorId: auth.userId,
      },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: task.organizationId,
        eventType: 'comment.mentioned',
        eventData: {
          comment,
          taskId: String(args.taskId),
          mentions,
          actorType: 'user',
          actorId: auth.userId,
        },
      });
    }

    // @-ing one of the PROJECT's agent instances puts it to work: the task is
    // (re)assigned to the first mentioned instance and a run kicks with this
    // comment as its feedback. Gated on WRITE access — commenting is
    // read-level, but assigning and running are edits, so a read-only
    // member's @ only notifies. A refusal (live engine, archived, missing
    // model) leaves the comment as a plain note; the run card's state is the
    // user-visible answer either way.
    await triggerMentionedProjectAgent(ctx, {
      task,
      project,
      auth,
      mentions,
      feedback: body,
    });

    const { unresolvedMentionTokens } = await resolveSurfaceMentions(ctx, {
      organizationId: task.organizationId,
      body,
      projectId: task.projectId,
    });

    return { messageId, threadId, unresolvedMentionTokens };
  },
});

/**
 * The comment-@mention work trigger: resolve the FIRST mentioned project
 * agent INSTANCE, reassign the task to it when it isn't the assignee yet
 * (`applyAssigneeChange` — activity, audit, notify, event, exactly like the
 * picker), then kick a run carrying the comment as feedback. Every refusal
 * is deliberately quiet: the comment has already posted and notified, and a
 * task with a live engine must keep it — the mention adds work, never
 * preempts it.
 */
async function triggerMentionedProjectAgent(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    project: Doc<'projects'>;
    auth: AuthContext;
    mentions: ResolvedMention[];
    feedback: string;
  },
): Promise<void> {
  const { task, project, auth } = args;
  let instance: Doc<'projectAgents'> | null = null;
  for (const mention of args.mentions) {
    if (mention.type !== 'agent') continue;
    const instanceId = ctx.db.normalizeId('projectAgents', mention.id);
    if (instanceId === null) continue; // a legacy slug mention — not this lane
    const candidate = await ctx.db.get(instanceId);
    if (candidate !== null && candidate.projectId === task.projectId) {
      instance = candidate;
      break;
    }
  }
  if (instance === null) return;

  if (
    !checkProjectAccess(project, auth.teamIds, auth.role).canEdit ||
    task.archivedAt !== undefined
  ) {
    return;
  }
  // The reassign-under-live-run invariant still holds — a mention during a
  // live run never reassigns and never starts a second engine. But when the
  // mentioned instance IS the running agent, the comment now STEERS the live
  // turn instead of being dropped: `steerTaskAgentTurn` injects it over the
  // harness's held-open stdin, or — for a harness that takes no input once
  // launched — restarts the exec around it and resumes the conversation. A
  // queued (capacity-parked) run needs nothing: its start reads the brief
  // AFTER this comment posted. An automation-driven task keeps its
  // automation, unchanged.
  const liveRun = await liveTaskAgentRun(ctx, task._id);
  if (liveRun !== null) {
    if (
      liveRun.status === 'running' &&
      String(liveRun.agentId) === String(instance._id)
    ) {
      const author = await getUserById(ctx, auth.userId);
      const authorName =
        (author?.name ?? '').trim() ||
        (author?.email ?? '').trim() ||
        'a teammate';
      await ctx.scheduler.runAfter(
        0,
        internal.tasks.agent_run_host.steerTaskAgentTurn,
        {
          organizationId: task.organizationId,
          runId: liveRun._id,
          taskId: task._id,
          agentId: liveRun.agentId,
          execId: liveRun.execId,
          sessionId: liveRun.sessionId,
          harness: liveRun.harness,
          deadlineAt: liveRun.deadlineAt,
          model: liveRun.model,
          ...(liveRun.modelProvider !== undefined
            ? { modelProvider: liveRun.modelProvider }
            : {}),
          ...(instance.instructions !== undefined
            ? { instructions: instance.instructions }
            : {}),
          skills: instance.skills,
          connectors: instance.connectors,
          tools: instance.tools ?? [],
          secrets: instance.secrets ?? [],
          feedback: args.feedback,
          author: authorName,
          authorId: auth.userId,
          attempt: 0,
        },
      );
    }
    return;
  }
  if (
    (await findLiveAutomationRunForTask(ctx, {
      organizationId: task.organizationId,
      projectId: task.projectId,
      taskId: task._id,
    })) !== null
  ) {
    return;
  }

  let current = task;
  if (
    task.assigneeType !== 'agent' ||
    task.assigneeId !== String(instance._id)
  ) {
    await applyAssigneeChange(ctx, {
      task,
      auth,
      assignee: { assigneeType: 'agent', assigneeId: String(instance._id) },
    });
    const reloaded = await ctx.db.get(task._id);
    if (reloaded === null) return;
    current = reloaded;
  }

  const kicked = await kickTaskAgentRun(ctx, {
    task: current,
    auth,
    trigger: 'mention',
    feedback: args.feedback,
  });
  if (!kicked.started) {
    console.warn(
      `[tasks] mention trigger for agent ${String(instance._id)} refused: ${kicked.reason ?? 'unknown'}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Edit / delete a comment (author-only edit; author-or-admin delete)
// ---------------------------------------------------------------------------

/**
 * The steer action's fallback door: the live engine settled while the
 * comment was in flight, so the mention degrades to what it means with no
 * live run — a fresh run carrying the comment as feedback. Attribution
 * stays with the comment's author (the kick is their gesture, delivered
 * late); the author already passed the comment ACL, and every kick guard
 * (agent ownership, single engine, breaker, model) still applies inside
 * `kickTaskAgentRun`.
 */
export const kickMentionRunAfterSteerMiss = internalMutation({
  args: {
    taskId: v.id('tasks'),
    authorId: v.string(),
    feedback: v.string(),
  },
  returns: v.object({
    started: v.boolean(),
    reason: v.optional(v.string()),
  }),
  // Explicit return type: this module and the run host reference each other
  // through `internal` (door → steer action → this fallback), and TS needs
  // one side annotated to break the inference cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; reason?: string }> => {
    const task = await ctx.db.get(args.taskId);
    if (task === null || task.archivedAt !== undefined) {
      return { started: false, reason: 'task_unavailable' };
    }
    const kicked = await kickTaskAgentRun(ctx, {
      task,
      auth: { userId: args.authorId },
      trigger: 'mention',
      feedback: args.feedback,
    });
    if (!kicked.started) {
      console.warn(
        `[tasks] steer-miss mention kick refused: ${kicked.reason ?? 'unknown'}`,
      );
    }
    return kicked;
  },
});

/**
 * Load a task-discussion message's side-car meta + its task/project/auth for an
 * edit/delete. The meta row is the authority for authorship (the message store
 * has none); a missing row means the comment doesn't exist (or was deleted).
 */
async function loadTaskMessageContext(ctx: MutationCtx, messageId: string) {
  const meta = await ctx.db
    .query('taskDiscussionMessageMeta')
    .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
    .first();
  if (!meta) {
    throw new ConvexError({ code: 'TASK_COMMENT_NOT_FOUND' });
  }
  const task = await loadTaskOrThrow(ctx, meta.taskId);
  const project = await loadProjectOrThrow(ctx, task.projectId);
  const auth = await getAuthContext(ctx, meta.organizationId);
  return { meta, task, project, auth };
}

export const editTaskDiscussionMessage = mutation({
  args: {
    messageId: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { meta, task, project, auth } = await loadTaskMessageContext(
      ctx,
      args.messageId,
    );
    // Read-level like posting (see addTaskComment) — a member who could post
    // must be able to fix their own comment. Delete already uses this gate.
    assertTaskReadable(project, auth);
    // Only the human author can edit their own comment.
    if (meta.authorType !== 'user' || meta.authorId !== auth.userId) {
      throw new ConvexError({ code: 'TASK_COMMENT_FORBIDDEN' });
    }

    const body = args.body.trim();
    if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
      throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
    }

    const directory = await buildMentionDirectory(ctx, {
      organizationId: meta.organizationId,
      project,
    });
    const mentions = extractMentions(
      body,
      directory.entries,
      directory.permissiveAgents,
    );
    // Same contract as description edits: only NEWLY added @mentions notify /
    // wake agents. Rewording around an existing mention must not re-trigger.
    const newlyAdded = addedMentions(meta.mentions ?? [], mentions);

    // Patch the message body in the store, then re-parse mentions + stamp the
    // edit marker in the meta row (the store has neither field).
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: args.messageId,
      patch: { message: { role: 'user', content: body } },
    });
    await ctx.db.patch(meta._id, {
      mentions: mentions.length > 0 ? mentions : undefined,
      editedAt: Date.now(),
    });

    await fanOutCommentEditMentions(ctx, {
      task,
      commentId: args.messageId,
      body,
      mentions: newlyAdded,
      actorId: auth.userId,
    });

    await createAuditLog(ctx, {
      organizationId: meta.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.commentUpdated,
      category: 'data',
      resourceType: TASK_COMMENT_RESOURCE_TYPE,
      resourceId: args.messageId,
      resourceName: task.title,
      metadata: {
        taskId: String(meta.taskId),
        addedMentionCount: newlyAdded.length,
      },
      status: 'success',
    });

    return null;
  },
});

export const deleteTaskDiscussionMessage = mutation({
  args: { messageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { meta, task, project, auth } = await loadTaskMessageContext(
      ctx,
      args.messageId,
    );
    assertTaskReadable(project, auth);
    const isAuthor =
      meta.authorType === 'user' && meta.authorId === auth.userId;
    if (!isAuthor && !ADMIN_ROLES.has(auth.role)) {
      throw new ConvexError({ code: 'TASK_COMMENT_FORBIDDEN' });
    }

    // Flat model (matches project discussions): no reply tree to cascade. Hard
    // delete the message from the store + its meta row, then decrement the
    // denormalized count (clamped).
    await ctx.runMutation(components.agent.messages.deleteByIds, {
      messageIds: [args.messageId],
    });
    await ctx.db.delete(meta._id);
    await ctx.db.patch(meta.taskId, {
      commentCount: Math.max(0, (task.commentCount ?? 0) - 1),
    });

    await createAuditLog(ctx, {
      organizationId: meta.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: TASK_AUDIT_ACTIONS.commentDeleted,
      category: 'data',
      resourceType: TASK_COMMENT_RESOURCE_TYPE,
      resourceId: args.messageId,
      resourceName: task.title,
      metadata: {
        taskId: String(meta.taskId),
        // Flat model — a message delete never cascades replies.
        cascadedReplyCount: 0,
      },
      status: 'success',
    });

    return null;
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

    const archivedAt = Date.now();
    await ctx.db.patch(args.taskId, {
      archivedAt,
      updatedAt: archivedAt,
    });
    await countTaskStateChanged(ctx, task.projectId, task, {
      status: task.status,
      archivedAt,
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
    await countTaskStateChanged(ctx, task.projectId, task, {
      status: task.status,
      archivedAt: undefined,
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
      ...(statusChanged
        ? {
            statusChangedAt: now,
            // Human status change resets the agent-run circuit breaker.
            agentRunsPausedAt: undefined,
            agentRunsPausedReason: undefined,
          }
        : {}),
    });
    // Unconditional — deliberately NOT gated on `statusChanged`. Gating would
    // duplicate the bucket rules here; a same-status reorder and a
    // within-bucket move (todo→in_progress) both no-op inside the helper.
    await countTaskStateChanged(ctx, task.projectId, task, {
      status: args.status,
      archivedAt: task.archivedAt,
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
            actorType: 'user',
            actorId: auth.userId,
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
    assigneeType: v.optional(taskAssigneeTypeValidator),
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
    const authCache = new Map<string, AuthContext | null>();
    // The assignee is constant across the batch; cache its resolved access
    // context per org and the resulting allow/deny per project.
    const assigneeCtxByOrg = new Map<
      string,
      { role: string; teamIds: string[] } | null
    >();
    const assigneeAllowedByProject = new Map<string, boolean>();

    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task) {
        skipped += 1;
        continue;
      }

      let auth = authCache.get(task.organizationId);
      if (auth === undefined) {
        try {
          auth = await getAuthContext(ctx, task.organizationId);
        } catch (error) {
          // The caller isn't a member of this task's org. Skip the task
          // rather than aborting the whole batch.
          console.warn(
            '[tasks] bulkUpdate: auth failed for task org, skipping',
            error,
          );
          auth = null;
        }
        authCache.set(task.organizationId, auth);
      }
      if (!auth) {
        skipped += 1;
        continue;
      }

      const projectKey = String(task.projectId);
      let canEdit = projectAccessCache.get(projectKey);
      if (canEdit === undefined) {
        const project = await ctx.db.get(task.projectId);
        canEdit = project
          ? checkProjectAccess(project, auth.teamIds, auth.role).canEdit
          : false;
        projectAccessCache.set(projectKey, canEdit);
      }
      if (!canEdit) {
        skipped += 1;
        continue;
      }

      // Archived rows are read-only unless this bulk op is itself an
      // archive/restore (`args.archived` set) — never mutate their content.
      if (task.archivedAt !== undefined && args.archived === undefined) {
        skipped += 1;
        continue;
      }

      const statusChanged =
        args.status !== undefined && args.status !== task.status;
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
        if (statusChanged) {
          patch.statusChangedAt = now;
          // Human status change resets the agent-run circuit breaker.
          patch.agentRunsPausedAt = undefined;
          patch.agentRunsPausedReason = undefined;
        }
      }
      if (args.priority !== undefined) {
        patch.priority = args.priority === null ? undefined : args.priority;
      }
      const assigneeChanged =
        (args.clearAssignee || assignee !== null) &&
        (task.assigneeId ?? null) !== (assignee?.assigneeId ?? null);
      // Same live-run transfer gate as `assignTask`, applied as a skip so one
      // task mid-run never aborts the whole batch.
      if (
        assigneeChanged &&
        ((await liveTaskAgentRun(ctx, taskId)) !== null ||
          (await findLiveAutomationRunForTask(ctx, {
            organizationId: task.organizationId,
            projectId: task.projectId,
            taskId,
          })) !== null)
      ) {
        skipped += 1;
        continue;
      }
      if (args.clearAssignee || assignee) {
        if (assignee) {
          // Per-project assignee gate. Access is per-project, so skip a task
          // whose project the assignee can't take rather than aborting the
          // whole batch (mirrors the `canEdit` skip above). Reuses the
          // `projectKey` computed for the canEdit gate earlier this iteration.
          let allowed = assigneeAllowedByProject.get(projectKey);
          if (allowed === undefined) {
            const assigneeProject = await ctx.db.get(task.projectId);
            if (!assigneeProject) {
              allowed = false;
            } else if (assignee.assigneeType === 'agent') {
              allowed = await agentAssigneeInProject(
                ctx,
                task.projectId,
                assignee.assigneeId,
              );
            } else if (assignee.assigneeId === auth.userId) {
              allowed = true; // self-assign is always safe
            } else {
              let assigneeCtx = assigneeCtxByOrg.get(task.organizationId);
              if (assigneeCtx === undefined) {
                assigneeCtx = await resolveUserAccessContext(
                  ctx,
                  task.organizationId,
                  assignee.assigneeId,
                );
                assigneeCtxByOrg.set(task.organizationId, assigneeCtx);
              }
              allowed =
                assigneeCtx !== null &&
                hasProjectAccess(
                  assigneeProject,
                  assigneeCtx.teamIds,
                  assigneeCtx.role,
                );
            }
            assigneeAllowedByProject.set(projectKey, allowed);
          }
          if (!allowed) {
            skipped += 1;
            continue;
          }
          await assertAgentAssigneeLive(ctx, task.organizationId, assignee);
        }
        patch.assigneeType = assignee?.assigneeType;
        patch.assigneeId = assignee?.assigneeId;
      }
      if (args.archived !== undefined) {
        patch.archivedAt = args.archived ? now : undefined;
      }
      await ctx.db.patch(taskId, patch);
      updated += 1;

      // Bulk edits feed the same activity timeline + automation events as
      // single-task edits — a bulk drag to in_review must trigger the same
      // workflows (e.g. the review gate) as moving cards one by one.
      const updatedTask = await ctx.db.get(taskId);
      if (!updatedTask) continue;
      // Counted from the re-read row, not from the assembled `patch`: this one
      // mutation can move status AND archivedAt in the same write, and the
      // post-patch doc is the only state that reflects both without
      // reconstructing the "did the patch set archivedAt to undefined on
      // purpose?" distinction. The helper re-reads the project each call, so
      // deltas accumulate correctly across loop iterations.
      await countTaskStateChanged(ctx, task.projectId, task, updatedTask);
      if (statusChanged && args.status !== undefined) {
        await recordActivity(ctx, {
          task,
          actorType: 'user',
          actorId: auth.userId,
          action: 'status.changed',
          fromValue: task.status,
          toValue: args.status,
        });
        // Watchers hear a bulk move exactly as they hear a single one — a drag
        // of twenty cards is twenty state changes, not a silent one. Collapse
        // keeps it to one row per task per dimension (see collab/coalesce.ts).
        await notifyTaskStatusChanged(ctx, {
          task: updatedTask,
          fromStatus: task.status,
          toStatus: args.status,
          actorType: 'user',
          actorId: auth.userId,
        });
        await emitEvent(ctx, {
          organizationId: task.organizationId,
          eventType: 'task.status_changed',
          eventData: {
            task: updatedTask,
            fromStatus: task.status,
            toStatus: args.status,
            actorType: 'user',
            actorId: auth.userId,
          },
        });
        // And a bulk drag INTO In review opens the gate, like the single-card
        // path — otherwise those cards sit there with nobody asked to review.
        if (args.status === 'in_review') {
          await requestTaskReview(ctx, {
            task: updatedTask,
            trigger: { kind: 'human', actorId: auth.userId },
          });
        }
      }
      if (assigneeChanged) {
        await recordActivity(ctx, {
          task,
          actorType: 'user',
          actorId: auth.userId,
          action: 'assignee.changed',
          fromValue: task.assigneeId ?? undefined,
          toValue: assignee?.assigneeId,
        });
        await notifyTaskAssigned(ctx, {
          task: updatedTask,
          assigneeType: assignee?.assigneeType ?? null,
          assigneeId: assignee?.assigneeId ?? null,
          actorType: 'user',
          actorId: auth.userId,
          ...(task.assigneeType !== undefined
            ? { previousAssigneeType: task.assigneeType }
            : {}),
          ...(task.assigneeId !== undefined
            ? { previousAssigneeId: task.assigneeId }
            : {}),
        });
        await emitEvent(ctx, {
          organizationId: task.organizationId,
          eventType: 'task.assigned',
          eventData: {
            task: updatedTask,
            assigneeType: assignee?.assigneeType ?? null,
            assigneeId: assignee?.assigneeId ?? null,
            previousAssigneeId: task.assigneeId ?? null,
            actorType: 'user',
            actorId: auth.userId,
          },
        });
      }
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

/**
 * Seed bug / feature / improvement on a project if missing. Idempotent —
 * safe to call from the manage dialog and from project create.
 */
export const ensureDefaultTaskLabels = mutation({
  args: { projectId: v.id('projects') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);
    await ensureDefaultProjectLabels(ctx, {
      organizationId: project.organizationId,
      projectId: args.projectId,
      createdBy: auth.userId,
    });
    return null;
  },
});

/**
 * Create a label in the project catalog. Colour is derived automatically from
 * the name (predefined map or stable hash) — callers cannot override it.
 */
export const createTaskLabel = mutation({
  args: {
    projectId: v.id('projects'),
    name: v.string(),
  },
  returns: v.id('taskLabels'),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);

    const names = normalizeLabelNames([args.name]);
    const name = names?.[0];
    if (!name) throw new ConvexError({ code: 'TASK_LABELS_INVALID' });

    const existing = await ctx.db
      .query('taskLabels')
      .withIndex('by_project_name', (q) =>
        q.eq('projectId', args.projectId).eq('name', name),
      )
      .unique();
    if (existing) throw new ConvexError({ code: 'TASK_LABEL_NAME_TAKEN' });

    const now = Date.now();
    return await ctx.db.insert('taskLabels', {
      organizationId: project.organizationId,
      projectId: args.projectId,
      name,
      color: defaultTaskLabelColor(name),
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Rename a project label. Colour follows the new name automatically. Tasks
 * hold ids, so rename does not rewrite tasks. Uniqueness is per project.
 */
export const updateTaskLabel = mutation({
  args: {
    labelId: v.id('taskLabels'),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const label = await ctx.db.get(args.labelId);
    if (!label) throw new ConvexError({ code: 'TASK_LABEL_NOT_FOUND' });
    const project = await loadProjectOrThrow(ctx, label.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);

    const names = normalizeLabelNames([args.name]);
    const name = names?.[0];
    if (!name) throw new ConvexError({ code: 'TASK_LABELS_INVALID' });
    if (name === label.name) return null;

    const clash = await ctx.db
      .query('taskLabels')
      .withIndex('by_project_name', (q) =>
        q.eq('projectId', label.projectId).eq('name', name),
      )
      .unique();
    if (clash) throw new ConvexError({ code: 'TASK_LABEL_NAME_TAKEN' });

    await ctx.db.patch(args.labelId, {
      name,
      color: defaultTaskLabelColor(name),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Delete a project label. By default refused while any task still references
 * it. Pass `detach: true` to strip the label from every task in the project
 * first (managed-dialog "delete" confirm), then remove the catalog row.
 *
 * Both paths scan the project's tasks: Convex cannot index membership of the
 * `labelIds` array, so there is no reverse lookup short of a junction table.
 * The refuse path stops at the first holder; only `detach` walks the whole
 * project, which stays inside a mutation's read budget at realistic per-project
 * task counts.
 */
export const deleteTaskLabel = mutation({
  args: {
    labelId: v.id('taskLabels'),
    detach: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const label = await ctx.db.get(args.labelId);
    if (!label) return null;
    const project = await loadProjectOrThrow(ctx, label.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);

    const detach = args.detach === true;
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', label.projectId))) {
      if (!task.labelIds?.includes(args.labelId)) continue;
      if (!detach) {
        throw new ConvexError({ code: 'TASK_LABEL_IN_USE' });
      }
      const next = task.labelIds.filter((id) => id !== args.labelId);
      await ctx.db.patch(task._id, {
        labelIds: next.length > 0 ? next : undefined,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.labelId);
    return null;
  },
});

/**
 * @deprecated Colour is automatic from the label name. This now only ensures
 * the catalog row exists (ignores `color`) for one release of old clients.
 */
export const setLabelColor = mutation({
  args: {
    projectId: v.id('projects'),
    label: v.string(),
    color: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await loadProjectOrThrow(ctx, args.projectId);
    const auth = await getAuthContext(ctx, project.organizationId);
    assertTaskWritable(project, auth);

    const names = normalizeLabelNames([args.label]);
    const name = names?.[0];
    if (!name) throw new ConvexError({ code: 'TASK_LABELS_INVALID' });

    const existing = await ctx.db
      .query('taskLabels')
      .withIndex('by_project_name', (q) =>
        q.eq('projectId', args.projectId).eq('name', name),
      )
      .unique();
    if (existing) return null;

    const now = Date.now();
    await ctx.db.insert('taskLabels', {
      organizationId: project.organizationId,
      projectId: args.projectId,
      name,
      color: defaultTaskLabelColor(name),
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
    return null;
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
        actorType: 'user',
        actorId: auth.userId,
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

  // Comments are messages in the task's `task_discussion` thread now. Delete
  // the side-car meta rows, then cascade the thread itself (its agent-component
  // messages + threadMetadata) via the canonical teardown. Single pass — a task
  // discussion is small; the helper is hold-aware and idempotent.
  const task = await ctx.db.get(taskId);
  if (task?.discussionThreadId) {
    for await (const meta of ctx.db
      .query('taskDiscussionMessageMeta')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
      await ctx.db.delete(meta._id);
    }
    await cascadeDeleteThreadChildren(ctx, {
      threadId: task.discussionThreadId,
      organizationId: task.organizationId,
    });
  }
  // Attachments aren't thread-bound, so the thread cascade above can't reach
  // them — purge each blob + its fileMetadata row explicitly.
  for (const att of task?.attachments ?? []) {
    await deleteStorageWithMetadata(ctx, att.fileId);
  }
  for await (const activity of ctx.db
    .query('taskActivity')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
    await ctx.db.delete(activity._id);
  }
  // Drop dependency edges on both sides so neither direction dangles.
  for await (const edge of ctx.db
    .query('taskDependencies')
    .withIndex('by_blocker', (q) => q.eq('blockerTaskId', taskId))) {
    await ctx.db.delete(edge._id);
  }
  for await (const edge of ctx.db
    .query('taskDependencies')
    .withIndex('by_blocked', (q) => q.eq('blockedTaskId', taskId))) {
    await ctx.db.delete(edge._id);
  }
  // Discount HERE, not in `deleteTask`: every node of the tree reaches this
  // line exactly once through the recursion above, so counting at the caller
  // would credit the root and leak every descendant. `task` is the row read
  // above; read its own projectId rather than the root's.
  if (task) {
    await countTaskDeleted(ctx, task.projectId, task);
  }
  await ctx.db.delete(taskId);
  return deletedChildren;
}

// ---------------------------------------------------------------------------
// Task agent runs (kick / cancel) — the agent-ownership board verbs
// ---------------------------------------------------------------------------

/** The run still holding this task (queued or running), if any. */
async function liveTaskAgentRun(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<Doc<'projectAgentRuns'> | null> {
  const runs = await ctx.db
    .query('projectAgentRuns')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))
    .collect();
  return (
    runs.find((run) => run.status === 'queued' || run.status === 'running') ??
    null
  );
}

/**
 * Kick a run of the task's assigned project agent — the agent-ownership
 * meaning of dragging the card to In progress (and of Retry, and of
 * In review → In progress "request changes"). Inserts the queued
 * `taskAgentRuns` row, moves the card to `in_progress` as the caller's own
 * status write, and schedules the node host. Refusals return a reason
 * instead of throwing so the board can toast and snap back.
 */
/**
 * The admission + kick core of a task agent run — shared by the explicit
 * verb (`startTaskAgentRun`) and the comment @mention trigger. The caller
 * has already authorized the write; this owns the guard matrix (agent
 * ownership, instance existence, model requirement, single live engine),
 * the queued run row, the caller-attributed move to In progress, and the
 * turn-start schedule. `feedback` (the mention comment's body) is stamped
 * on the run row and carried into the turn's brief.
 */
async function kickTaskAgentRun(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    auth: { userId: string };
    trigger: 'manual' | 'mention';
    feedback?: string;
  },
): Promise<{ started: boolean; reason?: string }> {
  const { task, auth } = args;
  if (task.assigneeType !== 'agent' || task.assigneeId === undefined) {
    return { started: false, reason: 'not_agent_owned' };
  }
  const agentDbId = ctx.db.normalizeId('projectAgents', task.assigneeId);
  if (agentDbId === null) {
    return { started: false, reason: 'agent_missing' };
  }
  const agent = await ctx.db.get(agentDbId);
  if (agent === null || agent.projectId !== task.projectId) {
    return { started: false, reason: 'agent_missing' };
  }
  if (agent.model === undefined || agent.model === '') {
    return { started: false, reason: 'agent_model_missing' };
  }
  if ((await liveTaskAgentRun(ctx, task._id)) !== null) {
    return { started: false, reason: 'already_running' };
  }
  // An automation run already operating this task blocks the agent lane —
  // two engines must never drive one subject at once.
  if (
    (await findLiveAutomationRunForTask(ctx, {
      organizationId: task.organizationId,
      projectId: task.projectId,
      taskId: task._id,
    })) !== null
  ) {
    return { started: false, reason: 'automation_run_live' };
  }

  const now = Date.now();
  const execId = crypto.randomUUID();
  const sessionId = sessionIdForProjectAgent(agentDbId);
  const deadlineAt = now + agentWorkTurnDeadlineMs();
  // Same task, same agent, same harness ⇒ the next turn CONTINUES the
  // previous harness conversation (`--resume`) instead of opening on a
  // rebuilt brief; the decision (and the fresh fallback's box semantics)
  // is shared verbatim with the capacity wake.
  const kickStart = await resolveTaskKickStartArgs(ctx, {
    taskId: task._id,
    agentId: agentDbId,
    harness: agent.harness,
    sessionId,
  });
  const runId = await ctx.db.insert('projectAgentRuns', {
    organizationId: task.organizationId,
    projectId: task.projectId,
    taskId: task._id,
    agentId: agentDbId,
    execId,
    sessionId,
    status: 'queued',
    harness: agent.harness,
    model: agent.model,
    ...(agent.modelProvider !== undefined
      ? { modelProvider: agent.modelProvider }
      : {}),
    startedBy: auth.userId,
    startedAt: now,
    deadlineAt,
    updatedAt: now,
    trigger: args.trigger,
    ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
  });

  // The board verb IS the interface: kicking the run moves the card. The
  // status write is the CALLER's act (they dragged / clicked / commented),
  // so it lands as a user activity, not an agent one.
  if (task.status !== 'in_progress') {
    const rank = await computeEndRank(ctx, task.projectId, 'in_progress');
    await ctx.db.patch(task._id, {
      status: 'in_progress',
      rank,
      completedAt: undefined,
      statusChangedAt: now,
      updatedAt: now,
      agentRunsPausedAt: undefined,
      agentRunsPausedReason: undefined,
    });
    // Kicking a run on a completed task pulls it back out of `done`.
    await countTaskStateChanged(ctx, task.projectId, task, {
      status: 'in_progress',
      archivedAt: task.archivedAt,
    });
    await recordActivity(ctx, {
      task,
      actorType: 'user',
      actorId: auth.userId,
      action: 'status.changed',
      fromValue: task.status,
      toValue: 'in_progress',
    });
  }

  await ctx.scheduler.runAfter(
    0,
    internal.tasks.agent_run_host.startTaskAgentTurn,
    {
      organizationId: task.organizationId,
      runId,
      taskId: task._id,
      agentId: agentDbId,
      execId,
      sessionId,
      harness: agent.harness,
      deadlineAt,
      ...kickStart,
      model: agent.model,
      ...(agent.modelProvider !== undefined
        ? { modelProvider: agent.modelProvider }
        : {}),
      ...(agent.instructions !== undefined
        ? { instructions: agent.instructions }
        : {}),
      skills: agent.skills,
      connectors: agent.connectors,
      tools: agent.tools ?? [],
      secrets: agent.secrets ?? [],
      ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
    },
  );
  return { started: true };
}

export const startTaskAgentRun = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.object({ started: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);
    assertTaskNotArchived(task);
    return await kickTaskAgentRun(ctx, { task, auth, trigger: 'manual' });
  },
});

/**
 * Cancel the task's live agent run (Cancel button; leaving In progress).
 * Marks the run cancelled first — the drive loop's orphan check makes any
 * in-flight window a no-op — then schedules the exec reap + key revoke.
 */
export const cancelTaskAgentRun = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await loadTaskOrThrow(ctx, args.taskId);
    const project = await loadProjectOrThrow(ctx, task.projectId);
    const auth = await getAuthContext(ctx, task.organizationId);
    assertTaskWritable(project, auth);

    const run = await liveTaskAgentRun(ctx, args.taskId);
    if (run === null) return null;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: 'cancelled',
      settledAt: now,
      updatedAt: now,
    });
    // Provenance ledger, atomic with the cancel stamp: `liveTaskAgentRun`
    // returned a non-terminal row and this patch is the run's one terminal
    // flip — the settle election's raced marks no-op on the now-terminal
    // status (their first-wins guard), so exactly one entry exists per run.
    await recordTaskAgentRunLedgerEntry(ctx, {
      run,
      finalStatus: 'cancelled',
      settledAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.tasks.agent_run_host.cancelTaskAgentExec,
      {
        organizationId: task.organizationId,
        sessionId: run.sessionId,
        execId: run.execId,
        agentId: run.agentId,
      },
    );
    return null;
  },
});
