import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  assertReadable,
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../domains/projects/service.ts';
import { addTaskComment, listTaskComments } from '../domains/tasks/comments.ts';
import { TASK_COMMENT_MAX } from '../domains/tasks/comments.ts';
import {
  startWorkflowForTask,
  upsertTaskByExternalRef,
} from '../domains/tasks/external-ref.ts';
import {
  loadTaskOrThrow,
  TASK_DESCRIPTION_MAX,
  type TaskRow,
} from '../domains/tasks/service.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  restProjectAuth,
  type RestEnv,
} from './shared.ts';

/**
 * /api/v1 tasks — the machine door for an external worker that materializes
 * an external item as a task, polls its state, starts the task's workflow,
 * and reports back as a comment.
 *
 * Every route runs org-strict (a multi-org key must NAME its organization,
 * reads included). Visibility is the MINTING USER's, re-run per request (a
 * task inherits its project's ACL): a task or project the key holder cannot
 * see answers exactly like one that does not exist (opaque 404). Unlike the
 * session create action, this door NEVER falls back to the org-wide project
 * — `projectId` is required.
 */

export function createTaskRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  // Org-strict middleware, scoped to THIS family's paths (an unscoped
  // `use` would leak onto every sibling family mounted beside this one).
  const orgStrict = async (
    c: Context<RestEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const ambiguous = await assertExplicitOrg(deps.sql, c);
    if (ambiguous) return ambiguous;
    return next();
  };
  app.use('/tasks', orgStrict);
  app.use('/tasks/*', orgStrict);

  /** One task by id, org-scoped AND gated on the minting user's READ
   * visibility. Garbage ids, cross-org ids, and invisible tasks all
   * collapse into null → the handlers' opaque 404 costs nothing extra. */
  const loadVisibleTask = async (
    c: Context<RestEnv>,
    auth: ProjectAuthContext,
    taskId: string,
  ): Promise<TaskRow | null> => {
    try {
      const task = await loadTaskOrThrow(deps.sql, taskId);
      if (task.organizationId !== c.get('organizationId')) return null;
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertReadable(project, auth);
      return task;
    } catch {
      return null;
    }
  };

  /** The wire shape of one task — labels resolved to their catalog NAMES
   * (the same tokens the create endpoint accepts). No run linkage: run
   * polling is `GET /api/v1/runs/{runId}`. */
  const taskPayload = async (task: TaskRow) => {
    const labels =
      task.labelIds.length > 0
        ? await deps.sql<{ name: string }[]>`
            SELECT name FROM app.task_labels
            WHERE id = ANY(${task.labelIds})
            ORDER BY name ASC
          `
        : [];
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      externalSystem: task.externalSystem ?? undefined,
      externalId: task.externalId ?? undefined,
      externalUrl: task.externalUrl ?? undefined,
      description: task.description ?? undefined,
      labels: labels.map((row) => row.name),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  };

  /**
   * POST /tasks — create a task bound to an external ref, idempotently
   * within the PROJECT: the same `(projectId, externalSystem, externalId)`
   * answers the existing task with `created: false` (200) instead of a
   * duplicate. The key's minting user is the CREATOR; an owning automation
   * (`automationSlug`, or a deployed `runWorkflowSlug`) becomes the
   * assignee. `externalId` is caller-owned — the platform never interprets
   * it.
   */
  app.post('/tasks', async (c) => {
    const body = z
      .object({
        projectId: z.string().min(1).max(64),
        externalSystem: z.string().min(1).max(100),
        externalId: z.string().min(1).max(500),
        // The upsert truncates over-long titles (external titles are not
        // under the caller's control); the transport cap refuses the absurd.
        title: z.string().min(1).max(2000),
        description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
        labels: z.array(z.string().max(100)).max(50).optional(),
        externalUrl: z.string().max(2048).optional(),
        runWorkflowSlug: z.string().max(200).optional(),
        automationSlug: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          error:
            'invalid body ("projectId", "externalSystem", "externalId" and "title" are required)',
        },
        400,
      );
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      try {
        const project = await loadProjectOrThrow(deps.sql, body.data.projectId);
        if (project.organizationId !== c.get('organizationId')) {
          return c.json({ error: 'Project not found' }, 404);
        }
        assertReadable(project, auth);
      } catch {
        return c.json({ error: 'Project not found' }, 404);
      }

      const result = await deps.sql.begin((tx) =>
        upsertTaskByExternalRef(tx, {
          organizationId: c.get('organizationId'),
          actorId: c.get('userId'),
          projectId: body.data.projectId,
          externalSystem: body.data.externalSystem,
          externalId: body.data.externalId,
          title: body.data.title,
          ...(body.data.externalUrl !== undefined
            ? { externalUrl: body.data.externalUrl }
            : {}),
          ...(body.data.description !== undefined
            ? { description: body.data.description }
            : {}),
          ...(body.data.labels !== undefined
            ? { labels: body.data.labels }
            : {}),
          externalState: 'open',
          creatorType: 'user',
          ...(body.data.runWorkflowSlug !== undefined
            ? { runWorkflowSlug: body.data.runWorkflowSlug }
            : {}),
          ...(body.data.automationSlug !== undefined
            ? { automationSlug: body.data.automationSlug }
            : {}),
          // An explicit project dedups PER PROJECT — the only scope this
          // door serves (no org-wide fallback, so no org-scope dedupe lane).
          dedupeScope: 'project',
        }),
      );
      // Creation is unconditional here (projectId required, createIfMissing
      // defaults true), so a null id is unreachable — same guard as 0.4.
      const taskId = result.taskId;
      if (taskId === null) {
        throw new Error('Failed to create or find the task for this issue');
      }

      // Start the named workflow on a FRESH create only (an idempotent
      // re-pick never re-kicks). 0.4 scheduled the start and answered
      // `executionId: null`; here the run starts inline, so the real run id
      // (or null when the slug is undeployed) is answered directly.
      let executionId: string | null | undefined;
      if (body.data.runWorkflowSlug !== undefined && result.created) {
        const task = await loadTaskOrThrow(deps.sql, taskId);
        const started = await startWorkflowForTask(deps.sql, {
          organizationId: c.get('organizationId'),
          task,
          workflowSlug: body.data.runWorkflowSlug,
          startedByUserId: c.get('userId'),
          startedVia: 'api-key',
        });
        executionId = started === null ? null : started.runId;
      }

      const payload = {
        task: { id: taskId, created: result.created },
        ...(executionId !== undefined ? { executionId } : {}),
      };
      return c.json(payload, result.created ? 201 : 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/tasks/:id', async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const task = await loadVisibleTask(c, auth, c.req.param('id'));
    if (task === null) return c.json({ error: 'Task not found' }, 404);
    return c.json({ task: await taskPayload(task) });
  });

  /** The discussion read lane: what an automation reported back and what
   * humans replied. Chronological, READ visibility like every task read. */
  app.get('/tasks/:id/comments', async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const task = await loadVisibleTask(c, auth, c.req.param('id'));
    if (task === null) return c.json({ error: 'Task not found' }, 404);
    try {
      const comments = await listTaskComments(deps.sql, auth, task.id);
      return c.json({
        comments: comments.map((comment) => {
          const view: Record<string, unknown> = {
            id: comment.messageId,
            authorType: comment.authorType,
            authorId: comment.authorId,
            body: comment.body,
            createdAt: comment.createdAt,
          };
          if (comment.editedAt !== null) view.editedAt = comment.editedAt;
          return view;
        }),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Post a comment AS THE KEY'S USER, through the same core the session
   * `addTaskComment` runs. */
  app.post('/tasks/:id/comments', async (c) => {
    const body = z
      .object({ body: z.string().min(1).max(TASK_COMMENT_MAX) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body ("body" is required)' }, 400);
    }
    const auth = await restProjectAuth(deps.sql, c);
    const task = await loadVisibleTask(c, auth, c.req.param('id'));
    if (task === null) return c.json({ error: 'Task not found' }, 404);
    try {
      const result = await deps.sql.begin((tx) =>
        addTaskComment(tx, auth, { taskId: task.id, body: body.data.body }),
      );
      return c.json({ comment: { id: result.messageId } }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /**
   * POST /tasks/{id}/start — start a deployed workflow on the task. RBAC
   * deliberately mirrors the session action: org membership + the task's
   * READ visibility, NOT the developer gate the arbitrary-input
   * `POST /automations/{name}/runs` applies — this run is task-subject-
   * bound, and deploying the workflow was the privileged act. Work-starting,
   * so it tops up on the `rest:execute` lane.
   */
  app.post('/tasks/:id/start', async (c) => {
    const limited = await chargeLane(deps.sql, c, 'rest:execute');
    if (limited) return limited;
    const body = z
      .object({ workflowSlug: z.string().min(1).max(200) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: 'invalid body ("workflowSlug" is required)' },
        400,
      );
    }
    const auth = await restProjectAuth(deps.sql, c);
    const task = await loadVisibleTask(c, auth, c.req.param('id'));
    if (task === null) return c.json({ error: 'Task not found' }, 404);

    const started = await startWorkflowForTask(deps.sql, {
      organizationId: c.get('organizationId'),
      task,
      workflowSlug: body.data.workflowSlug,
      startedByUserId: c.get('userId'),
      startedVia: 'api-key',
    });
    // Exact parity with the session shape: `not_started` covers an
    // undeployed slug (and any swallowed start failure); `already_running`
    // answers the in-flight run's id instead of racing a duplicate.
    if (started === null) {
      return c.json({
        started: false,
        reason: 'not_started',
        executionId: null,
      });
    }
    if (started.alreadyRunning) {
      return c.json({
        started: false,
        reason: 'already_running',
        executionId: started.runId,
      });
    }
    return c.json({ started: true, executionId: started.runId });
  });

  return app;
}
