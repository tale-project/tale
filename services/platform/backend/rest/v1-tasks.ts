import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { isHttpUrl } from '../../lib/utils/url.ts';
import { TASK_LABEL_CHARS_MAX, TASK_TITLE_MAX } from '../core/tasks/helpers.ts';
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
  TASK_COMMENT_PAGE_DEFAULT,
  TASK_COMMENT_PAGE_MAX,
} from '../domains/tasks/comments.ts';
import {
  findTaskByExternalRef,
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
  mintCursor,
  readIntegerCursor,
  readJsonBody,
  readPageLimit,
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
        // The board's own cap: a validating door refuses an over-long
        // title by name rather than storing a silently clipped one (the
        // domain's ellipsis truncation stays for the lanes that import
        // titles nobody chose — a GitHub issue, a sandbox native).
        title: z.string().min(1).max(TASK_TITLE_MAX),
        description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
        labels: z
          .array(z.string().max(TASK_LABEL_CHARS_MAX))
          .max(50)
          .optional(),
        // Rendered as a link to the source item — http(s) only, so a
        // stored `javascript:` URL can never reach an anchor.
        externalUrl: z
          .string()
          .max(2048)
          .refine(isHttpUrl, { message: 'must be an absolute http(s) URL' })
          .optional(),
        // The source item's lifecycle: `closed` parks the task for review
        // (done, when the actor may complete it), `open` reopens a done
        // task — the domain's external-state rule, exposed as the mirror
        // worker's close/reopen verb. Defaults to `open`.
        externalState: z.enum(['open', 'closed']).optional(),
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
      const { externalState, runWorkflowSlug, ...intake } = body.data;
      const result = await transactSerializable(deps.sql, async (tx) => {
        await loadRestProject(tx, auth, projectId, { write: true });
        // A repeat is a reconcile of the existing task, and the docs ask
        // for a stable payload on retry: the run workflow only ever starts
        // a CREATE, so only a create validates its project binding — a
        // repeat used to 403 on it and drop the title/description update.
        // The owner (`automationSlug`) is validated either way: a repeat
        // may still backfill an empty assignee with it.
        const existing = await findTaskByExternalRef(tx, {
          organizationId: auth.organizationId,
          projectId,
          externalSystem: intake.externalSystem,
          externalId: intake.externalId,
          dedupeScope: 'project',
        });
        await assertIntakeAutomations(
          tx,
          auth,
          projectId,
          existing === null
            ? { ...intake, runWorkflowSlug }
            : { automationSlug: intake.automationSlug },
        );
        return upsertTaskByExternalRef(tx, {
          ...intake,
          ...(existing === null && runWorkflowSlug !== undefined
            ? { runWorkflowSlug }
            : {}),
          organizationId: auth.organizationId,
          actorId: auth.userId,
          projectId,
          externalState: externalState ?? 'open',
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
    // The same page-size and cursor posture as every other list on the
    // door: a clamped `limit`, `INVALID_LIMIT` for a non-number, and a
    // SIGNED cursor this task's discussion answered (`INVALID_CURSOR` for
    // any other) — this route used to hand-roll its own 400 sentence and
    // read any well-formed number as a position.
    const limit = readPageLimit(c, {
      fallback: TASK_COMMENT_PAGE_DEFAULT,
      max: TASK_COMMENT_PAGE_MAX,
    });
    if (limit instanceof Response) return limit;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const task = await loadVisibleTask(
        deps.sql,
        auth,
        c.req.param('id'),
        c.req.param('taskId'),
      );
      const list = `task-comments:${task.id}`;
      const cursor = readIntegerCursor(c, list, { max: 2_147_483_647 });
      if (cursor instanceof Response) return cursor;
      const page = await listTaskComments(deps.sql, auth, task.id, {
        limit,
        ...(cursor !== null ? { before: cursor } : {}),
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
        continueCursor:
          page.nextCursor === null
            ? ''
            : mintCursor(c, list, String(page.nextCursor)),
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
