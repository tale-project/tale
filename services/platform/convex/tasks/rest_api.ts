/**
 * Tasks REST API handlers — the machine door for an external worker that
 * materializes an external item as a task, polls its state, starts the task's
 * workflow, and reports back as a comment.
 *
 * Endpoints:
 *   POST /api/v1/tasks               — Idempotent create from an external ref
 *   GET  /api/v1/tasks/:id           — Get task state
 *   POST /api/v1/tasks/:id/start     — Start a deployed workflow on the task
 *   POST /api/v1/tasks/:id/comments  — Comment as the key's minting user
 *
 * Every handler runs with `{ requireExplicitOrgSlug: true }`: this door WRITES
 * into a tenant, so a multi-org key must name its organization via
 * `X-Organization-Slug` instead of riding the dashboard's drifting last-active
 * pointer.
 *
 * Visibility is the MINTING USER's, re-run per request with the explicit
 * userId (a task inherits its project's ACL): a task or project the key
 * holder cannot see answers exactly like one that does not exist (opaque
 * 404). Unlike the session create action, this door NEVER falls back to the
 * org-wide project — `projectId` is required.
 */

import { v, type Infer } from 'convex/values';

import { internal } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import {
  applyRateLimit,
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonOk,
  optionalString,
  optionalStringArray,
  readJsonObject,
  requiredString,
  withRestAuth,
  type RestContext,
} from '../lib/rest/helpers';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import {
  loadTaskLabelDocs,
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
} from './helpers';
import { startWorkflowForTask } from './public_actions';
import { taskStatusValidator } from './schema';

const PREFIX = '/api/v1/tasks/';

/**
 * The projection the REST reads answer — enough for a worker to poll task
 * state after a restart, nothing more. Labels are resolved to their catalog
 * NAMES (the same tokens the create endpoint accepts). No run linkage: the
 * task row carries none, and resolving the live run is a bounded run scan —
 * run polling is `GET /api/v1/runs/{runId}` with the executionId the start
 * endpoint answered.
 */
const restTaskValidator = v.object({
  _id: v.id('tasks'),
  title: v.string(),
  status: taskStatusValidator,
  projectId: v.id('projects'),
  externalSystem: v.optional(v.string()),
  externalId: v.optional(v.string()),
  externalUrl: v.optional(v.string()),
  description: v.optional(v.string()),
  labels: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

type RestTask = Infer<typeof restTaskValidator>;

/**
 * One task by wire id, org-scoped AND gated on the minting user's READ
 * visibility — the same `checkProjectAccess` standard the session
 * `getTask`/`addTaskComment` path applies, re-run with the explicit userId
 * (`resolveProjectAccessForUser`, failing closed). Garbage ids, cross-org
 * ids, and invisible tasks all collapse into `null`, so the handlers' opaque
 * 404 costs nothing extra.
 */
export const restGetTaskForUser = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    taskId: v.string(),
  },
  returns: v.union(restTaskValidator, v.null()),
  handler: async (ctx, args): Promise<RestTask | null> => {
    const taskId = ctx.db.normalizeId('tasks', args.taskId);
    if (taskId === null) return null;
    const task = await ctx.db.get(taskId);
    if (!task || task.organizationId !== args.organizationId) return null;
    const access = await resolveProjectAccessForUser(ctx, task.projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) return null;
    const labels = (await loadTaskLabelDocs(ctx, task.labelIds)).map(
      (label) => label.name,
    );
    return {
      _id: task._id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      externalSystem: task.externalSystem,
      externalId: task.externalId,
      externalUrl: task.externalUrl,
      description: task.description,
      labels,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  },
});

/** The wire shape of one task (`_id` → `id`). */
function taskPayload(task: RestTask): Record<string, unknown> {
  return {
    id: String(task._id),
    title: task.title,
    status: task.status,
    projectId: String(task.projectId),
    externalSystem: task.externalSystem,
    externalId: task.externalId,
    externalUrl: task.externalUrl,
    description: task.description,
    labels: task.labels,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// /api/v1/tasks (exact path)
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/tasks — create a task bound to an external ref, idempotently
 * within the project: the same `(projectId, externalSystem, externalId)`
 * answers the existing task with `created: false` (200) instead of a
 * duplicate. The same upsert the session create action runs (`creatorType:
 * 'user'`, `dedupeScope: 'project'`, `externalState: 'open'`), with the key's
 * minting user as the actor. RBAC mirrors the session action: org membership
 * (proven by org resolution) — plus, on this door, the target project must be
 * VISIBLE to the minting user (opaque 404 otherwise; the session action's
 * project resolve runs under the caller's own session).
 *
 * `projectId` is REQUIRED — this door never falls back to the org-wide
 * project. `externalId` is the caller-owned natural key; the platform never
 * interprets the value (the session action's `ensureFolder` folder
 * materialization is deliberately not exposed here).
 */
export const createTaskRest = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await readJsonObject(request);
    const projectIdRaw = requiredString(body, 'projectId', 64);
    const externalSystem = requiredString(body, 'externalSystem', 100);
    const externalId = requiredString(body, 'externalId', 500);
    // The upsert truncates over-long titles like the session path does
    // (external titles are not under the caller's control); the transport cap
    // only refuses the absurd.
    const title = requiredString(body, 'title', 2000);
    const description = optionalString(
      body,
      'description',
      TASK_DESCRIPTION_MAX,
    );
    const labels = optionalStringArray(body, 'labels', 50);
    const externalUrl = optionalString(body, 'externalUrl', 2048);
    const runWorkflowSlug = optionalString(body, 'runWorkflowSlug', 200);
    // Owner attribution WITHOUT starting anything: the task belongs to this
    // automation (assignee, createdByType 'app'), which is what the task
    // modal's work panel — Start button, run progress, operator questions —
    // keys on. A worker creating desk tasks should always send it.
    const automationSlug = optionalString(body, 'automationSlug', 200);

    const project = await rc.ctx.runQuery(
      internal.projects.internal_queries.getProjectByIdForOrg,
      { organizationId: rc.org.organizationId, projectId: projectIdRaw },
    );
    if (!project) return jsonError('Project not found', 404);
    const access = await rc.ctx.runQuery(
      internal.projects.internal_queries.getProjectAccessForUser,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        projectId: String(project._id),
      },
    );
    if (!access.canRead) return jsonError('Project not found', 404);

    const result = await rc.ctx.runMutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: rc.org.organizationId,
        actorId: rc.user.userId,
        projectId: project._id,
        externalSystem,
        externalId,
        title,
        externalUrl,
        description,
        labels,
        externalState: 'open',
        // The key's minting user is the CREATOR; an owning automation
        // (automationSlug, or a deployed runWorkflowSlug) becomes the
        // assignee — the session action's worker-class attribution, unchanged.
        creatorType: 'user',
        runWorkflowSlug,
        automationSlug,
        // An explicit project dedups PER PROJECT — the only scope this door
        // serves (no org-wide fallback, so no org-scope dedupe lane).
        dedupeScope: 'project',
      },
    );
    // Creation is unconditional here (projectId is required and
    // createIfMissing defaults true), so a null id is unreachable — the same
    // guard the session action keeps.
    const taskId = result.taskId;
    if (!taskId) {
      throw new Error('Failed to create or find the task for this issue');
    }

    // Mirror the session semantics: the workflow start is SCHEDULED, not
    // awaited — `executionId: null` says "a start was kicked but no run
    // identity exists yet". Skipped on an idempotent re-pick.
    let executionId: string | null | undefined;
    if (runWorkflowSlug && result.created) {
      await rc.ctx.runMutation(
        internal.tasks.internal_mutations.scheduleTaskWorkflowStart,
        {
          organizationId: rc.org.organizationId,
          taskId,
          workflowSlug: runWorkflowSlug,
          userId: rc.user.userId,
          startedVia: 'api-key',
        },
      );
      executionId = null;
    }

    const payload = {
      task: { id: String(taskId), created: result.created },
      ...(executionId !== undefined ? { executionId } : {}),
    };
    return result.created ? jsonCreated(payload) : jsonOk(payload);
  },
  { requireExplicitOrgSlug: true },
);

// ---------------------------------------------------------------------------
// /api/v1/tasks/{id}[...] (prefix) — GET
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/tasks/{id}/comments — the discussion read lane: the worker
 * fetches what an automation reported back (prepared figures, operator
 * questions, setup summaries) and what humans replied. Chronological, capped
 * at the same bound the UI renders; READ visibility, like every task read.
 */
async function listTaskCommentsAction(
  rc: RestContext,
  id: string,
): Promise<Response> {
  const task = await rc.ctx.runQuery(
    internal.tasks.rest_api.restGetTaskForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      taskId: id,
    },
  );
  if (!task) return jsonError('Task not found', 404);

  const messages = await rc.ctx.runQuery(
    internal.tasks.internal_queries.listTaskDiscussionMessagesInternal,
    {
      organizationId: rc.org.organizationId,
      taskId: task._id,
    },
  );
  return jsonOk({
    comments: messages.map((message) => {
      const comment: Record<string, unknown> = {
        id: message.messageId,
        authorType: message.authorType,
        authorId: message.authorId,
        body: message.body,
        createdAt: message.createdAt,
      };
      if (message.editedAt !== undefined) {
        comment.editedAt = message.editedAt;
      }
      return comment;
    }),
  });
}

export const getTaskResource = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing task ID', 400);
    if (subPath === 'comments') return await listTaskCommentsAction(rc, id);
    if (subPath !== null) return jsonError(`Unknown resource: ${subPath}`, 404);

    const task = await rc.ctx.runQuery(
      internal.tasks.rest_api.restGetTaskForUser,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        taskId: id,
      },
    );
    if (!task) return jsonError('Task not found', 404);
    return jsonOk({ task: taskPayload(task) });
  },
  { requireExplicitOrgSlug: true },
);

// ---------------------------------------------------------------------------
// /api/v1/tasks/{id}/… (prefix) — POST
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/tasks/{id}/start — start a deployed workflow on the task, the
 * REST twin of the session `startTaskWorkflow` action. RBAC deliberately
 * mirrors it: org membership + the task's READ visibility, NOT the developer
 * gate the arbitrary-input `POST /api/v1/automations/{name}/runs` applies —
 * this run is task-subject-bound (its input IS the task), which narrows the
 * blast radius, and deploying the workflow was the privileged act. Attribution
 * is stamped `api-key:<userId>` on the run so machine starts stay
 * distinguishable from human UI starts.
 */
async function startTaskAction(
  rc: RestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const body = await readJsonObject(request);
  const workflowSlug = requiredString(body, 'workflowSlug', 200);

  const task = await rc.ctx.runQuery(
    internal.tasks.rest_api.restGetTaskForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      taskId: id,
    },
  );
  if (!task) return jsonError('Task not found', 404);

  const started = await startWorkflowForTask(rc.ctx, {
    organizationId: rc.org.organizationId,
    task,
    workflowSlug,
    startedByUserId: rc.user.userId,
    startedVia: 'api-key',
  });
  // Exact parity with the session action's return shape: `not_started` covers
  // an undeployed slug (and any swallowed start failure); `already_running`
  // answers the in-flight run's id instead of racing a duplicate.
  if (!started) {
    return jsonOk({ started: false, reason: 'not_started', executionId: null });
  }
  if (started.alreadyRunning) {
    return jsonOk({
      started: false,
      reason: 'already_running',
      executionId: started.runId,
    });
  }
  return jsonOk({ started: true, executionId: started.runId });
}

/**
 * POST /api/v1/tasks/{id}/comments — post a comment AS THE KEY'S USER
 * (author = minting user, actor/authorType 'user'), through the same core the
 * session `addTaskComment` runs — READ-level gate, `TASK_COMMENT_MAX`, the
 * per-user `task:comment` budget, and the @mention fan-out included.
 */
async function addTaskCommentAction(
  rc: RestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const body = await readJsonObject(request);
  const commentBody = requiredString(body, 'body', TASK_COMMENT_MAX);

  const result = await rc.ctx.runMutation(
    internal.tasks.mutations.addTaskCommentForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      userEmail: rc.user.email || undefined,
      taskId: id,
      body: commentBody,
    },
  );
  return jsonCreated({ comment: { id: result.messageId } });
}

/**
 * One POST handler serves the whole prefix (the router takes one handler per
 * method+prefix), wrapped in the plain CRUD bucket. Starting a workflow is
 * WORK-STARTING, so that sub-path tops up with a `rest:execute` charge — its
 * effective rate is the tighter of the two lanes.
 */
export const taskPostActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing task ID', 400);

    if (subPath === 'start') {
      const limited = await applyRateLimit(rc.ctx, 'rest:execute', request);
      if (limited) return limited;
      return await startTaskAction(rc, request, id);
    }
    if (subPath === 'comments') {
      return await addTaskCommentAction(rc, request, id);
    }

    return jsonError(`Unknown action: ${subPath ?? ''}`, 404);
  },
  { requireExplicitOrgSlug: true },
);
