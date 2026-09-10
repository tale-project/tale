import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  AutomationError,
  bindingProjectIds,
  deployedVersion,
} from '../domains/automations/store.ts';
import type { ProjectAuthContext } from '../domains/projects/service.ts';
import {
  addTaskComment,
  listTaskComments,
  TASK_COMMENT_MAX,
  TASK_COMMENT_PAGE_MAX,
  taskCommentCursorSchema,
} from '../domains/tasks/comments.ts';
import {
  startWorkflowForTaskInTx,
  upsertTaskByExternalRef,
} from '../domains/tasks/external-ref.ts';
import {
  loadTaskOrThrow,
  TASK_DESCRIPTION_MAX,
  TaskError,
  type TaskRow,
} from '../domains/tasks/service.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  invalidBodyResponse,
  loadRestProject,
  readJsonBody,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * The project's task machine door: materialize an external item, read the
 * task, start its workflow, and join its discussion. Every operation names
 * its project in the path and rechecks the key holder's current visibility.
 * Intake and execution need project write access; comments stay read-level.
 */
export function createTaskRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();
  const orgStrict = async (
    c: Context<RestEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const ambiguous = await assertExplicitOrg(deps.sql, c);
    if (ambiguous) return ambiguous;
    return next();
  };
  app.use('/projects/:id/tasks', orgStrict);
  app.use('/projects/:id/tasks/*', orgStrict);

  /** The path project must own the task even when the user can read both
   * projects. Only known visibility failures become 404; outages propagate. */
  const loadVisibleTask = async (
    sql: Sql | TransactionSql,
    auth: ProjectAuthContext,
    projectId: string,
    taskId: string,
    options: { write?: boolean; active?: boolean } = {},
  ): Promise<TaskRow> => {
    const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
    if (task.projectId !== projectId) {
      throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
    }
    // Check identity before write permission so a task under the wrong
    // project cannot be distinguished through an editor/archive refusal.
    await loadRestProject(sql, auth, projectId, options);
    return task;
  };

  const taskPayload = async (task: TaskRow) => {
    const labels =
      task.labelIds.length > 0
        ? await deps.sql<{ name: string }[]>`
            SELECT name FROM app.task_labels
            WHERE org_id = ${task.organizationId}
              AND project_id = ${task.projectId}
              AND id = ANY(${task.labelIds})
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

  /** The owning automation must be deployed and applicable to this project.
   * An undeployed run-only slug keeps the existing not-started response. */
  const assertIntakeAutomations = async (
    tx: TransactionSql,
    auth: ProjectAuthContext,
    projectId: string,
    input: { automationSlug?: string; runWorkflowSlug?: string },
  ): Promise<void> => {
    const names = new Set([input.automationSlug, input.runWorkflowSlug]);
    for (const name of names) {
      if (name === undefined) continue;
      if (
        name === input.automationSlug &&
        (await deployedVersion(tx, auth.organizationId, name)) === undefined
      ) {
        throw new AutomationError(
          'AUTOMATION_NOT_FOUND',
          'The owning automation is not deployed.',
          404,
        );
      }
      const bindings = await bindingProjectIds(tx, auth.organizationId, name);
      if (bindings.length > 0 && !bindings.includes(projectId)) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_FORBIDDEN',
          'The automation is not bound to this project.',
          403,
        );
      }
    }
  };

  /** Recheck the fresh task and active project in the same transaction as
   * the mutex-protected start; also used by intake after its task commits. */
  const startTaskWorkflow = async (
    auth: ProjectAuthContext,
    projectId: string,
    taskId: string,
    workflowSlug: string,
  ): Promise<Awaited<ReturnType<typeof startWorkflowForTaskInTx>>> =>
    transactSerializable(deps.sql, async (tx) => {
      const task = await loadVisibleTask(tx, auth, projectId, taskId, {
        write: true,
      });
      return startWorkflowForTaskInTx(tx, {
        organizationId: auth.organizationId,
        task,
        workflowSlug,
        startedByUserId: auth.userId,
        startedVia: 'api-key',
      });
    });

  app.post('/projects/:id/tasks', async (c) => {
    const body = z
      .object({
        externalSystem: z.string().min(1).max(100),
        externalId: z.string().min(1).max(500),
        // External titles are truncated by the domain; the transport only
        // refuses an absurdly large import before attempting a write.
        title: z.string().min(1).max(2000),
        description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
        labels: z.array(z.string().max(100)).max(50).optional(),
        externalUrl: z.string().max(2048).optional(),
        runWorkflowSlug: z.string().min(1).max(200).optional(),
        automationSlug: z.string().min(1).max(200).optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      await loadRestProject(deps.sql, auth, projectId, { write: true });
      // A rate refusal must precede the task commit. A retried request that
      // names a workflow is still a work-start attempt, even if it dedupes.
      if (body.data.runWorkflowSlug !== undefined) {
        const limited = await chargeLane(deps.sql, c, 'rest:execute');
        if (limited) return limited;
      }
      const result = await transactSerializable(deps.sql, async (tx) => {
        await loadRestProject(tx, auth, projectId, { write: true });
        await assertIntakeAutomations(tx, auth, projectId, body.data);
        return upsertTaskByExternalRef(tx, {
          ...body.data,
          organizationId: auth.organizationId,
          actorId: auth.userId,
          projectId,
          externalState: 'open',
          creatorType: 'user',
          dedupeScope: 'project',
        });
      });
      const taskId = result.taskId;
      if (taskId === null) {
        throw new Error('Failed to create or find the task for this issue');
      }
      let executionId: string | null | undefined;
      if (body.data.runWorkflowSlug !== undefined && result.created) {
        // The task is already committed. A later start failure cannot turn
        // that successful intake into an error implying nothing was saved.
        executionId = await startTaskWorkflow(
          auth,
          projectId,
          taskId,
          body.data.runWorkflowSlug,
        ).then(
          (started) => started?.runId ?? null,
          (error: unknown) => {
            console.error(
              '[task-workflow] start after create failed',
              body.data.runWorkflowSlug,
              error,
            );
            return null;
          },
        );
      }
      return c.json(
        {
          task: { id: taskId, created: result.created },
          ...(executionId !== undefined ? { executionId } : {}),
        },
        result.created ? 201 : 200,
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/tasks/:taskId', async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const task = await loadVisibleTask(
        deps.sql,
        auth,
        c.req.param('id'),
        c.req.param('taskId'),
      );
      return c.json({ task: await taskPayload(task) });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** The newest page is chronological within the page; continueCursor
   * walks toward the beginning of the task's discussion. */
  app.get('/projects/:id/tasks/:taskId/comments', async (c) => {
    const query = z
      .object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(TASK_COMMENT_PAGE_MAX)
          .optional(),
        cursor: taskCommentCursorSchema,
      })
      .safeParse({
        limit: c.req.query('limit'),
        cursor: c.req.query('cursor'),
      });
    if (!query.success) {
      return c.json(
        {
          error: `Invalid query: limit must be 1..${TASK_COMMENT_PAGE_MAX} and cursor a continueCursor from a previous page`,
        },
        400,
      );
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const task = await loadVisibleTask(
        deps.sql,
        auth,
        c.req.param('id'),
        c.req.param('taskId'),
      );
      const page = await listTaskComments(deps.sql, auth, task.id, {
        ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
        ...(query.data.cursor !== undefined
          ? { before: query.data.cursor }
          : {}),
      });
      return c.json({
        comments: page.comments.map((comment) => ({
          id: comment.messageId,
          authorType: comment.authorType,
          authorId: comment.authorId,
          body: comment.body,
          createdAt: comment.createdAt,
          ...(comment.editedAt !== null ? { editedAt: comment.editedAt } : {}),
        })),
        isDone: !page.hasMore,
        continueCursor: page.nextCursor === null ? '' : String(page.nextCursor),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.post('/projects/:id/tasks/:taskId/comments', async (c) => {
    const body = z
      .object({ body: z.string().min(1).max(TASK_COMMENT_MAX) })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      const taskId = c.req.param('taskId');
      await loadVisibleTask(deps.sql, auth, projectId, taskId, {
        active: true,
      });
      const limited = await chargeLane(deps.sql, c, 'task:comment');
      if (limited) return limited;
      const result = await transactSerializable(deps.sql, async (tx) => {
        const task = await loadVisibleTask(tx, auth, projectId, taskId, {
          active: true,
        });
        return addTaskComment(tx, auth, {
          taskId: task.id,
          body: body.data.body,
        });
      });
      return c.json({ comment: { id: result.messageId } }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Task-bound execution uses project write access, not the developer
   * capability required for arbitrary automation input. */
  app.post('/projects/:id/tasks/:taskId/start', async (c) => {
    const body = z
      .object({ workflowSlug: z.string().min(1).max(200) })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      const taskId = c.req.param('taskId');
      await loadVisibleTask(deps.sql, auth, projectId, taskId, { write: true });
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const started = await startTaskWorkflow(
        auth,
        projectId,
        taskId,
        body.data.workflowSlug,
      );
      if (started === null)
        return c.json({
          started: false,
          reason: 'not_started',
          executionId: null,
        });
      if (started.alreadyRunning)
        return c.json({
          started: false,
          reason: 'already_running',
          executionId: started.runId,
        });
      return c.json({ started: true, executionId: started.runId });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  return app;
}
