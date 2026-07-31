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
import { assertAgentAssigneeLive } from '../agents/installations';
import { createAuditLog } from '../audit_logs/helpers';
import {
  notifyTaskAssigned,
  notifyTaskComment,
  notifyTaskMentions,
  notifyTaskStatusChanged,
} from '../collab/notify';
import { emitEvent } from '../events/emit';
import { assertAgentAssigneeInProject } from '../projects/resolve_project_access';
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
  truncateImportedTitle,
  workflowActivityContext,
} from './helpers';
import { parseIssueNumber, parseRepoRef } from './issue_ref';
import {
  extractMentions,
  parseMentionTokens,
  type ResolvedMention,
} from './mentions';
import {
  type CommentEventComment,
  taskActivityAttributionValidator,
  taskAssigneeTypeValidator,
  taskCreatorTypeValidator,
  taskPriorityValidator,
  taskStatusValidator,
} from './schema';

const optionalAttribution = v.optional(taskActivityAttributionValidator);

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

/**
 * No-op replacement for
 * `automationOwnerOfWorkflowSlug` (from the retired `workflows/triggers/slug_mutations.ts`)
 * — the workflows/automations domain is retired wholesale. Single caller
 * (`agentUpsertTaskByExternalRef` below), so inlined rather than re-created as
 * a module. Always reports "no owning app" (`null`); the caller already
 * treats that as "attribute the task to the syncing agent instead of an
 * installed app" (`ownerAutomation ?? args.actorId`), which is exactly what
 * happens when no app owns the slug today, so external-issue sync (task CRUD)
 * keeps working — every synced task is just attributed to the agent, never an
 * app, until this is restored.
 */
async function automationOwnerOfWorkflowSlug(
  ctx: MutationCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<string | null> {
  // On the rebuilt engine the workflow slug IS the automation's store name:
  // a DEPLOYED automation of that name owns the tasks it operates.
  const deployment = await ctx.db
    .query('automationDeployments')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', workflowSlug),
    )
    .first();
  return deployment === null ? null : workflowSlug;
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
    attribution: optionalAttribution,
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
      // Task-ops loop-safety invariant (v): decomposition depth = 1. Agents
      // and automations may create subtasks of ROOT tasks only — a subtask
      // never gets agent-created children of its own, so decomposition
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
        context: workflowActivityContext(args.actorId, args.attribution),
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
 * Upsert a task from an external system, keyed by an external natural key whose
 * SCOPE the caller chooses via `dedupeScope` (mirrors the read split between
 * `listTasksByOrg` and `listTasksByProject`):
 *  - `'org'` (default): `(organizationId, externalSystem, externalId)` — one task
 *    per issue per org. The org-wide sync workflows and any org-scoped app use
 *    this (their home is the org-wide project).
 *  - `'project'`: `(projectId, externalSystem, externalId)` — one task per issue
 *    per PROJECT, so a project-scoped app (issue-desk) bound to two projects
 *    materializes the same issue into two INDEPENDENT tasks (each with its own
 *    workflow run), instead of the second project silently retargeting the first.
 * Idempotent within its scope: a re-pick patches the existing task instead of
 * creating a duplicate (mirrors the `documents.externalItemId` upsert).
 *
 * Status policy keeps local triage authoritative while letting the external
 * system own the open/closed lifecycle:
 *  - create: `closed` → 'done', otherwise → {@link SYNC_OPEN_STATUS}
 *  - existing + `closed`: move to 'done' (unless already terminal)
 *  - existing + `open`: reopen to {@link SYNC_OPEN_STATUS} only when currently
 *    `done` (issue reopened on GitHub). A human `cancelled` dismissal is left
 *    alone — sync must not resurrect rejected proposals.
 *  - otherwise the local status is left untouched
 *
 * Drives the GitHub issue-sync automation (configs/platform/custom/automations/github/)
 * through the generic `task` workflow action — there is no GitHub-specific
 * backend code.
 */
export const agentUpsertTaskByExternalRef = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    /** Destination project for a CREATE. Required when a task may be created
     *  (the default) and for `dedupeScope:'project'` lookups; omittable for an
     *  org-scope, `createIfMissing:false` reconcile that only updates existing
     *  tasks (the update path keys off the found task's own project). */
    projectId: v.optional(v.id('projects')),
    externalSystem: v.string(),
    externalId: v.string(),
    title: v.string(),
    externalUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    /** How to treat `description` on an UPDATE to an existing bound task:
     *  - `'set'` (default): overwrite — an explicit human action (quick-create)
     *    (re)generates the description.
     *  - `'preserve'`: keep a non-empty existing description — a background
     *    re-sync must not clobber a task's clean/localized description (it's a
     *    stable pointer; the agent reads live issue details via `externalUrl`). */
    descriptionMode: v.optional(
      v.union(v.literal('set'), v.literal('preserve')),
    ),
    labels: v.optional(v.array(v.string())),
    priority: v.optional(taskPriorityValidator),
    externalState: v.optional(v.union(v.literal('open'), v.literal('closed'))),
    /** The workflow this create launches (e.g. the app's desk-process). When it
     *  belongs to an installed app, the new task is attributed to that app
     *  (`createdByType:'app'`, `createdBy:<automationSlug>`) — the ownership signal the
     *  generic task loops arbitrate on. */
    runWorkflowSlug: v.optional(v.string()),
    /** App ownership WITHOUT the run-on-create coupling: attribute the task to
     *  this automation (`createdByType:'app'`) even when no workflow starts at
     *  creation — the desks' "create now, Start after the files arrive" shape.
     *  Wins over the `runWorkflowSlug` derivation when both are present. */
    automationSlug: v.optional(v.string()),
    /** Attribute the CREATE to this actor type, with `actorId` as the id —
     *  the template-create path passes `'user'`: a HUMAN created the task;
     *  the owning automation is the ASSIGNEE, not the author. Absent = the
     *  derived app/agent attribution (sync and workflow callers). */
    creatorType: v.optional(taskCreatorTypeValidator),
    /** Dedup scope for the external natural key (see the doc comment):
     *  `'project'` keys on the project (one task per issue per project);
     *  `'org'` (default) keys on the org (one task per issue per org). */
    dedupeScope: v.optional(v.union(v.literal('org'), v.literal('project'))),
    /** What to do when the external ref matches no existing task:
     *  - `true` (default): create one (needs `projectId`) — the intake sync.
     *  - `false`: no-op (`taskId: null`) — an UPDATE-ONLY reconcile that only
     *    closes/reopens tasks already on the board, never materializing a task
     *    for every issue, and so can run org-scoped without a `projectId`. */
    createIfMissing: v.optional(v.boolean()),
    attribution: optionalAttribution,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ taskId: Id<'tasks'> | null; created: boolean }> => {
    // External titles (e.g. GitHub issue titles) can exceed our board's
    // `TASK_TITLE_MAX` and aren't editable at the import site, so truncate
    // rather than reject — failing here makes "Create task" unusable for any
    // long issue. Fall back to the external ref if the source title is blank.
    const title =
      truncateImportedTitle(args.title) ||
      `${args.externalSystem} ${args.externalId}`;
    const description = args.description?.trim() || undefined;
    const now = Date.now();
    const createIfMissing = args.createIfMissing ?? true;

    // Dedup within the chosen scope: project-scoped apps look up by project so the
    // same issue in another project is treated as absent (→ a new task); the
    // default org scope keeps the one-task-per-issue-per-org sync behavior. The
    // project lookup needs an explicit projectId; the org lookup does not — which
    // is what lets an update-only reconcile run without one.
    let existing: Doc<'tasks'> | null;
    if (args.dedupeScope === 'project') {
      const projectId = args.projectId;
      if (!projectId) {
        throw new Error(
          "agentUpsertTaskByExternalRef: dedupeScope 'project' requires a projectId",
        );
      }
      existing = await ctx.db
        .query('tasks')
        .withIndex('by_project_external', (q) =>
          q
            .eq('projectId', projectId)
            .eq('externalSystem', args.externalSystem)
            .eq('externalId', args.externalId),
        )
        .first();
    } else {
      existing = await ctx.db
        .query('tasks')
        .withIndex('by_org_external', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('externalSystem', args.externalSystem)
            .eq('externalId', args.externalId),
        )
        .first();
    }

    if (existing) {
      // Preserve a non-empty existing description when asked (re-sync), so a
      // background pass never clobbers a clean/localized description.
      const preserveDescription =
        args.descriptionMode === 'preserve' &&
        existing.description !== undefined &&
        existing.description.trim() !== '';
      const patch: Partial<Doc<'tasks'>> = {
        title,
        ...(preserveDescription ? {} : { description }),
        // Only overwrite labels when the caller actually supplied them. An
        // update-only reconcile (e.g. the sync-github-issues bundle's
        // `reconcile_task`, which forwards no labels) would otherwise patch
        // `labels: undefined` — and in Convex a patch to `undefined` DELETES
        // the field, silently wiping the labels `triage-github-issues` set on
        // the same task minutes earlier. An explicit `[]` still clears.
        ...(args.labels !== undefined ? { labels: args.labels } : {}),
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
      } else if (args.externalState === 'open' && existing.status === 'done') {
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
          context: workflowActivityContext(args.actorId, args.attribution),
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

    // No existing task. An update-only reconcile stops here (it never floods the
    // board with a task per issue); the intake sync falls through to create.
    if (!createIfMissing) {
      return { taskId: null, created: false };
    }
    const projectId = args.projectId;
    if (!projectId) {
      throw new Error(
        'agentUpsertTaskByExternalRef: creating a task requires a projectId',
      );
    }
    const project = await loadProjectInOrg(ctx, projectId, args.organizationId);

    const status: Doc<'tasks'>['status'] =
      args.externalState === 'closed' ? 'done' : SYNC_OPEN_STATUS;
    const rank = await computeEndRank(ctx, projectId, status);
    const number = await nextTaskNumber(ctx, project);
    // A create launched by an installed app's workflow is OWNED by that app:
    // attribute it to the app (createdByType:'app', createdBy:<automationSlug>) so the
    // generic task loops defer to the app's own workflow. Otherwise it's an
    // agent-authored task as before.
    const ownerAutomation =
      args.automationSlug ??
      (args.runWorkflowSlug
        ? await automationOwnerOfWorkflowSlug(
            ctx,
            args.organizationId,
            args.runWorkflowSlug,
          )
        : null);
    // Creator vs owner: the creator is WHO made the task (a human on the
    // template path), the owning automation becomes the ASSIGNEE — the
    // worker-class trichotomy (user/agent/automation) lives on assignment.
    const createdByUser = args.creatorType === 'user';
    const taskId = await ctx.db.insert('tasks', {
      organizationId: args.organizationId,
      projectId,
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
      createdBy: createdByUser
        ? args.actorId
        : (ownerAutomation ?? args.actorId),
      createdByType: createdByUser ? 'user' : ownerAutomation ? 'app' : 'agent',
      ...(ownerAutomation !== null && {
        assigneeType: 'app' as const,
        assigneeId: ownerAutomation,
      }),
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
    });
    const task = await ctx.db.get(taskId);
    if (task) {
      await recordActivity(ctx, {
        task,
        actorType: createdByUser ? 'user' : 'agent',
        actorId: args.actorId,
        action: 'created',
        toValue: status,
        context: workflowActivityContext(args.actorId, args.attribution),
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
        projectId: String(projectId),
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
    attribution: optionalAttribution,
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    if (task.status === args.status) return { ok: true };

    // HARD RULE (task-ops invariant): agents never complete work. The only
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
      context: workflowActivityContext(args.actorId, args.attribution),
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
    assigneeType: v.optional(taskAssigneeTypeValidator),
    assigneeId: v.optional(v.string()),
    attribution: optionalAttribution,
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const task = await loadTaskInOrg(ctx, args.taskId, args.organizationId);
    const assignee = normalizeAssignee({
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
    });
    await assertAgentAssigneeLive(ctx, args.organizationId, assignee);
    if (assignee?.assigneeType === 'agent') {
      await assertAgentAssigneeInProject(
        ctx,
        task.projectId,
        assignee.assigneeId,
      );
    }
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
      context: workflowActivityContext(args.actorId, args.attribution),
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
 * Record a run-admission refusal on the task's product activity timeline
 * (action `'agent_run.refused'`, `toValue` = the machine `refusedReason`).
 * Refusals happen BEFORE `startTaskAgentRun` inserts a `taskAgentRuns` row,
 * so without this row the failure never appears in the task detail's
 * activity feed (#2609). Actor = the agent that was asked to run; `context`
 * carries the dispatching workflow when known. Missing task → quiet no-op
 * (there is no timeline left to write to).
 */
export const recordAgentRunRefused = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    agentSlug: v.string(),
    refusedReason: v.string(),
    attribution: optionalAttribution,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) return null;
    const { workflowSlug, wfExecutionId } = args.attribution ?? {};
    await recordActivity(ctx, {
      task,
      actorType: 'agent',
      actorId: args.agentSlug,
      action: 'agent_run.refused',
      toValue: args.refusedReason,
      context:
        workflowSlug || wfExecutionId
          ? { workflowSlug, wfExecutionId }
          : undefined,
    });
    return null;
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
    /** Optional write-time locale snapshot (workflow `bodyI18n`). */
    bodyByLocale?: { en: string; de: string; fr: string };
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
    ...(args.bodyByLocale ? { bodyByLocale: args.bodyByLocale } : {}),
  });
  return { messageId, threadId, mentions };
}

const bodyByLocaleValidator = v.object({
  en: v.string(),
  de: v.string(),
  fr: v.string(),
});

export const agentAddComment = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    taskId: v.id('tasks'),
    body: v.string(),
    bodyByLocale: v.optional(bodyByLocaleValidator),
    attribution: optionalAttribution,
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
    let bodyByLocale = args.bodyByLocale;
    if (bodyByLocale) {
      const trimmed = {
        en: bodyByLocale.en.trim(),
        de: bodyByLocale.de.trim(),
        fr: bodyByLocale.fr.trim(),
      };
      if (
        trimmed.en.length === 0 ||
        trimmed.de.length === 0 ||
        trimmed.fr.length === 0 ||
        trimmed.en.length > TASK_COMMENT_MAX ||
        trimmed.de.length > TASK_COMMENT_MAX ||
        trimmed.fr.length > TASK_COMMENT_MAX
      ) {
        throw new ConvexError({ code: 'TASK_COMMENT_INVALID' });
      }
      bodyByLocale = trimmed;
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
        bodyByLocale,
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
      context: workflowActivityContext(args.actorId, args.attribution),
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

// App-owned tasks used to be skipped by the generic sweeps while their app's
// `automationInstallations` row existed (the app's own workflow drove them).
// The 0.4 baseline reset dropped that install bookkeeping, so every task —
// app-created or not — falls through to the sweeps, exactly the retired
// check's "app uninstalled" branch (no app-owned task is left with no driver
// and no sweep, I10).

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
  assigneeType: v.optional(taskAssigneeTypeValidator),
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
      assigneeType?: 'user' | 'agent' | 'app';
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
      assigneeType?: 'user' | 'agent' | 'app';
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
    attribution: optionalAttribution,
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
      context: workflowActivityContext(args.actorId, args.attribution),
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

/**
 * Queue a subject-linked workflow start for a newly created task without
 * blocking the create action. `createTaskFromExternalIssue` returns as soon as
 * the task row exists so the desk can latch Created; the engine runs on the
 * next scheduler tick.
 *
 * The hop schedules the live engine's own task-start door — a scheduled
 * MUTATION, so the hand-off is exactly-once and the run row it creates is
 * covered by the liveness sweep from birth. Soft-fails exactly like the
 * task-board Start it mirrors: a vanished task or an automation name with no
 * deployment logs and leaves the task untouched — the board's Start stays
 * the recovery path.
 */
export const scheduleTaskWorkflowStart = internalMutation({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    workflowSlug: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.organizationId !== args.organizationId) {
      console.warn(
        '[task-workflow] scheduled start: task not found',
        args.taskId,
      );
      return null;
    }
    const issueNumber = parseIssueNumber(task.externalId);
    const repoRef = parseRepoRef(task.externalId);
    await ctx.scheduler.runAfter(
      0,
      internal.automations.mutations.startTaskWorkflowRun,
      {
        organizationId: args.organizationId,
        name: args.workflowSlug,
        taskId: String(args.taskId),
        projectId: task.projectId,
        startedBy: `user:${args.userId}`,
        // The same subject shape the task-board Start builds — the workflow
        // templates read `input.task.*`.
        input: {
          task: {
            id: String(args.taskId),
            title: task.title,
            status: task.status,
            projectId: String(task.projectId),
            ...(task.externalSystem !== undefined
              ? { externalSystem: task.externalSystem }
              : {}),
            ...(task.externalId !== undefined
              ? { externalId: task.externalId }
              : {}),
            ...(task.externalUrl !== undefined
              ? { externalUrl: task.externalUrl }
              : {}),
            ...(issueNumber !== null ? { issueNumber } : {}),
            ...(repoRef !== null
              ? { repo: `${repoRef.owner}/${repoRef.repo}` }
              : {}),
          },
        },
      },
    );
    return null;
  },
});
