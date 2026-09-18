import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { externalKeySchema } from '../../lib/shared/utils/external-key.ts';
import { isHttpUrl } from '../../lib/utils/url.ts';
import {
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
} from '../core/tasks/helpers.ts';
import { createAuditLog } from '../domains/audit_logs/service.ts';
import {
  AutomationError,
  automationExists,
  bindingProjectIds,
  deployedVersion,
} from '../domains/automations/store.ts';
import {
  getProjectAuthContext,
  type ProjectAuthContext,
} from '../domains/projects/service.ts';
import {
  addTaskComment,
  listTaskComments,
  TASK_COMMENT_MAX,
  TASK_COMMENT_PAGE_DEFAULT,
  TASK_COMMENT_PAGE_MAX,
} from '../domains/tasks/comments.ts';
import {
  findTaskByExternalRef,
  resolveSetupFolderId,
  startWorkflowForTaskInTx,
  upsertTaskByExternalRef,
} from '../domains/tasks/external-ref.ts';
import { getPendingReviewForTask } from '../domains/tasks/reviews.ts';
import {
  loadTaskOrThrow,
  TASK_DESCRIPTION_MAX,
  TaskError,
  type TaskRow,
  updateTaskStatus,
} from '../domains/tasks/service.ts';
import {
  actorBodySchema,
  refusedForActor,
  resolveRequestActor,
} from './actor.ts';
import {
  chargeLane,
  domainErrorResponse,
  loadRestProject,
  mintCursor,
  noQuery,
  PAGE_QUERY,
  parseBody,
  readIntegerCursor,
  readPageLimit,
  readQuery,
  type RestEnv,
  restProjectAuth,
  RestRefusal,
} from './shared.ts';

/** The caller-owned external ref, canonical (NFC, trimmed) and never
 * blank — the one rule the project family's `externalItemId` follows. */
const externalSystemSchema = externalKeySchema(100);
const externalIdSchema = externalKeySchema(500);
const taskIntakeBody = z
  .object({
    externalSystem: externalSystemSchema,
    externalId: externalIdSchema,
    // The board's own cap: a validating door refuses an over-long title
    // by name rather than storing a silently clipped one (the domain's
    // ellipsis truncation stays for the lanes that import titles nobody
    // chose — a GitHub issue, a sandbox native). Whitespace-only is a
    // missing title, named as such.
    title: z.string().trim().min(1).max(TASK_TITLE_MAX),
    description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
    labels: z
      .array(z.string().trim().min(1).max(TASK_LABEL_CHARS_MAX))
      .max(TASK_LABELS_MAX)
      .optional(),
    // Rendered as a link to the source item — http(s) only, so a
    // stored `javascript:` URL can never reach an anchor. A folder id
    // never travels here: `setupFolderName` is how a desk binds one.
    externalUrl: z
      .string()
      .max(2048)
      .refine(isHttpUrl, { message: 'must be an absolute http(s) URL' })
      .optional(),
    // The desks' binding convention (`resolveSetupFolderId`): the name of
    // a ROOT folder of the project, matched without regard to case, whose
    // id becomes the task's `externalUrl` — what a folder-driven automation
    // reads off `input.task.externalUrl`. The app's `from-external-issue`
    // door takes the same name under `ensureFolder`; this door could not
    // bind a folder at all once `externalUrl` became an http(s) URL by
    // contract. Either this or `externalUrl`, never both.
    setupFolderName: z.string().trim().min(1).max(255).optional(),
    // The source item's lifecycle: `closed` parks the task for review
    // (done, when the actor may complete it), `open` reopens a done
    // task — the domain's external-state rule, exposed as the mirror
    // worker's close/reopen verb. Defaults to `open`.
    externalState: z.enum(['open', 'closed']).optional(),
    runWorkflowSlug: z.string().min(1).max(200).optional(),
    automationSlug: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.setupFolderName === undefined || body.externalUrl === undefined,
    {
      message: 'cannot be sent together with externalUrl',
      path: ['setupFolderName'],
    },
  );
const taskCommentBody = z
  .object({ body: z.string().trim().min(1).max(TASK_COMMENT_MAX) })
  .strict();
const taskStartBody = z
  .object({ workflowSlug: z.string().min(1).max(200) })
  .strict();
/**
 * A review decision relayed for a person: `approve` closes the gate the way
 * the board's move to Done does; `request_changes` puts the person's words
 * on the timeline and starts the workflow again with them as its feedback,
 * so it needs both the comment and the workflow to start.
 */
const taskReviewBody = z
  .object({
    decision: z.enum(['approve', 'request_changes']),
    comment: z.string().trim().min(1).max(TASK_COMMENT_MAX).optional(),
    workflowSlug: z.string().min(1).max(200).optional(),
    actor: actorBodySchema,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.decision !== 'request_changes') return;
    if (body.comment === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message: 'is required when requesting changes',
      });
    }
    if (body.workflowSlug === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['workflowSlug'],
        message: 'is required when requesting changes',
      });
    }
  });

/** The run a task door started (or found running), under BOTH names: the
 * automations family and the run URLs say `runId`; `executionId` is the
 * name this family shipped with and stays as an alias. */
function runRef(runId: string | null): {
  runId: string | null;
  executionId: string | null;
} {
  return { runId, executionId: runId };
}

/**
 * The project's task machine door: materialize an external item, read the
 * task, start its workflow, and join its discussion. Every operation names
 * its project in the path and rechecks the key holder's current visibility.
 * Intake and execution need project write access; comments stay read-level.
 */
export function createTaskRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  /**
   * The URL is judged left to right: the project first (absent, foreign
   * or invisible → 404 `PROJECT_NOT_FOUND`, so a bad project id is blamed
   * on the project, never on the task), then the task, which the path
   * project must own even when the user can read both projects (404
   * `TASK_NOT_FOUND`), and only then the write and active checks — so a
   * task under the wrong project cannot be told apart through an
   * editor/archive refusal. A mutation on an archived task is refused the
   * way one on an archived project is (403 `TASK_ARCHIVED`): the contract
   * promises "an active task". Only known visibility failures become
   * 404; outages propagate.
   */
  const loadVisibleTask = async (
    sql: Sql | TransactionSql,
    auth: ProjectAuthContext,
    projectId: string,
    taskId: string,
    options: { write?: boolean; active?: boolean } = {},
  ): Promise<TaskRow> => {
    await loadRestProject(sql, auth, projectId);
    const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
    if (task.projectId !== projectId) {
      throw new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
    }
    if (options.write || options.active) {
      await loadRestProject(sql, auth, projectId, options);
      if (task.archivedAt !== null) {
        throw new RestRefusal('Task is archived', 403, 'TASK_ARCHIVED');
      }
    }
    return task;
  };

  const taskPayload = async (task: TaskRow) => {
    // As stored — the spelling the label was created with — in the order
    // the task carries them, which is the order they were sent: a mirror
    // compares what it sent with what it reads back.
    const labels =
      task.labelIds.length > 0
        ? await deps.sql<{ name: string }[]>`
            SELECT name FROM app.task_labels
            WHERE org_id = ${task.organizationId}
              AND project_id = ${task.projectId}
              AND id = ANY(${task.labelIds})
            ORDER BY array_position(${task.labelIds}::text[], id)
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
      // The archived marker, present exactly when the task is archived —
      // the state the comment and start doors refuse with `TASK_ARCHIVED`.
      // A task is archived from the board; this door has no verb for it, so
      // a mirror reads the state here instead of learning it from a 403.
      archivedAt: task.archivedAt ?? undefined,
    };
  };

  /** The automation a task door names must exist and be deployed — the two
   * refusals every other door answers, each under its own code: a name
   * nobody saved is 404 `AUTOMATION_NOT_FOUND`, a saved one with nothing
   * deployed is 409 `AUTOMATION_NOT_DEPLOYED`, the sentence naming it and
   * what to do next (`deployHint`). One check behind the intake's owner and
   * the start door: the start door used to fold both absences into a 200
   * `not_started` after the intake had already split them (2026-09-13
   * evaluation, E2-03). */
  const assertDeployedAutomation = async (
    sql: Sql | TransactionSql,
    organizationId: string,
    name: string,
    deployHint: string,
  ): Promise<void> => {
    if (!(await automationExists(sql, organizationId, name))) {
      // The one wrong spelling worth a hint: the `{name}` path parameter
      // writes a name's "/" as "__", and a reader who carries that rule
      // into a body field used to get a bare 404 (2026-09-14 evaluation,
      // h3). Existence is still not revealed — the hint keys on the
      // spelling alone.
      throw new AutomationError(
        'AUTOMATION_NOT_FOUND',
        name.includes('__')
          ? 'Automation not found — in a body field the name is written as it is listed ("billing/dunning"); "__" is only the URL spelling of "/"'
          : 'Automation not found',
        404,
      );
    }
    if ((await deployedVersion(sql, organizationId, name)) === undefined) {
      throw new AutomationError(
        'AUTOMATION_NOT_DEPLOYED',
        `"${name}" has no deployed version — ${deployHint}.`,
        409,
      );
    }
  };

  /** The owning automation must exist, be deployed and be applicable to
   * this project — three refusals, each under its own code: the two of
   * `assertDeployedAutomation`, and 403 for one bound elsewhere. An
   * undeployed run-only slug keeps the existing not-started response. */
  const assertIntakeAutomations = async (
    tx: TransactionSql,
    auth: ProjectAuthContext,
    projectId: string,
    input: { automationSlug?: string; runWorkflowSlug?: string },
  ): Promise<void> => {
    const names = new Set([input.automationSlug, input.runWorkflowSlug]);
    for (const name of names) {
      if (name === undefined) continue;
      if (name === input.automationSlug) {
        await assertDeployedAutomation(
          tx,
          auth.organizationId,
          name,
          'deploy it before assigning tasks to it',
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
   * the mutex-protected start; also used by intake after its task commits.
   *
   * READ COMMITTED, not serializable: the guard in `startWorkflowForTaskInTx`
   * takes an advisory lock and then reads the live runs, and a read-committed
   * statement takes a fresh snapshot — so once a racing door commits its run,
   * this probe sees it and answers `already_running`. Under SERIALIZABLE the
   * transaction's snapshot froze at its first statement, before the lock, so
   * concurrent starts each read "no live run" and began separate billable
   * runs (2026-09-14 evaluation, g5-1). The task reload stays inside the
   * transaction, so a task moved or archived between the door's preflight and
   * the start is still caught; the one-live-run index (`0102`) is the durable
   * backstop under any isolation. */
  const startTaskWorkflow = async (
    auth: ProjectAuthContext,
    projectId: string,
    taskId: string,
    workflowSlug: string,
  ): Promise<Awaited<ReturnType<typeof startWorkflowForTaskInTx>>> => {
    // postgres.js's begin result conditionally unwraps arrays; hold the
    // nullable result outside that conditional return type.
    let outcome: Awaited<ReturnType<typeof startWorkflowForTaskInTx>> = null;
    await deps.sql.begin('isolation level read committed', async (tx) => {
      const task = await loadVisibleTask(tx, auth, projectId, taskId, {
        write: true,
      });
      outcome = await startWorkflowForTaskInTx(tx, {
        organizationId: auth.organizationId,
        task,
        workflowSlug,
        startedByUserId: auth.userId,
        startedVia: 'api-key',
      });
    });
    return outcome;
  };

  app.post('/projects/:id/tasks', async (c) => {
    const body = await parseBody(c, taskIntakeBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      await loadRestProject(deps.sql, auth, projectId, { write: true });
      // A rate refusal must precede the task commit. A retried request that
      // names a workflow is still a work-start attempt, even if it dedupes.
      if (body.runWorkflowSlug !== undefined) {
        const limited = await chargeLane(deps.sql, c, 'rest:execute');
        if (limited) return limited;
      }
      const { externalState, runWorkflowSlug, setupFolderName, ...intake } =
        body;
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
        // A named Setup folder is resolved in this transaction on every
        // intake — a repeat keeps the binding fresh — and only its id
        // reaches the domain, as `externalUrl`; the name never does.
        const externalUrl =
          setupFolderName === undefined
            ? intake.externalUrl
            : await resolveSetupFolderId(tx, {
                organizationId: auth.organizationId,
                projectId,
                setupFolderName,
              });
        return upsertTaskByExternalRef(tx, {
          ...intake,
          ...(externalUrl !== undefined ? { externalUrl } : {}),
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
      let runId: string | null | undefined;
      if (body.runWorkflowSlug !== undefined && result.created) {
        // The task is already committed. A later start failure cannot turn
        // that successful intake into an error implying nothing was saved.
        runId = await startTaskWorkflow(
          auth,
          projectId,
          taskId,
          body.runWorkflowSlug,
        ).then(
          (started) => started?.runId ?? null,
          (error: unknown) => {
            console.error(
              '[task-workflow] start after create failed',
              body.runWorkflowSlug,
              error,
            );
            return null;
          },
        );
      }
      const payload = {
        task: { id: taskId, created: result.created },
        ...(runId !== undefined ? runRef(runId) : {}),
      };
      // A create names the new task in `Location`, the resource's own path,
      // the way the other 201 doors do and the spec declares — a generated
      // client that follows it got nothing (2026-09-18 evaluation, J3-2).
      // An upsert that matched an existing task is a 200 and carries none.
      return result.created
        ? c.json(payload, 201, {
            location: `/api/v1/projects/${c.req.param('id')}/tasks/${taskId}`,
          })
        : c.json(payload, 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/tasks/:taskId', noQuery, async (c) => {
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
    const query = readQuery(c, PAGE_QUERY);
    if (query instanceof Response) return query;
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
    const body = await parseBody(c, taskCommentBody);
    if (body instanceof Response) return body;
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
        return addTaskComment(tx, auth, { taskId: task.id, body: body.body });
      });
      return c.json({ comment: { id: result.messageId } }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Task-bound execution uses project write access, not the developer
   * capability required for arbitrary automation input. */
  app.post('/projects/:id/tasks/:taskId/start', async (c) => {
    const body = await parseBody(c, taskStartBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      const taskId = c.req.param('taskId');
      await loadVisibleTask(deps.sql, auth, projectId, taskId, { write: true });
      // The workflow's two absences are the intake's two refusals (404 /
      // 409), judged before the execute budget is charged — a slug the
      // contract refuses spends nothing. `not_started` below is left for
      // the residual: a deployment withdrawn between this check and the
      // start's own read.
      await assertDeployedAutomation(
        deps.sql,
        auth.organizationId,
        body.workflowSlug,
        'deploy it before starting it on a task',
      );
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const started = await startTaskWorkflow(
        auth,
        projectId,
        taskId,
        body.workflowSlug,
      );
      if (started === null)
        return c.json({
          started: false,
          reason: 'not_started',
          ...runRef(null),
        });
      if (started.alreadyRunning)
        return c.json({
          started: false,
          reason: 'already_running',
          ...runRef(started.runId),
        });
      return c.json({ started: true, ...runRef(started.runId) });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** The task's open review — what a reviewer decides on — beside the
   * task's status, so a poller learns in one read whether a decision is
   * due. Null when no review is pending. Read-level, like the task. */
  app.get('/projects/:id/tasks/:taskId/review', noQuery, async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      const taskId = c.req.param('taskId');
      const task = await loadVisibleTask(deps.sql, auth, projectId, taskId);
      const review = await getPendingReviewForTask(
        deps.sql,
        auth.organizationId,
        task.id,
      );
      return c.json({
        task: { id: task.id, status: task.status },
        review,
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /**
   * Decide a task's review FOR a person. The decision is the person's own
   * gesture relayed from another application, so the body names them
   * (`actor`, see `./actor.ts`) and the key holder needs the right to act
   * for others; the person's own project access and the organization's
   * `review_policy` then apply exactly as on the board — `approve` is the
   * move to Done (policy-checked, recorded, audited by
   * `closePendingTaskReviewOnStatusLeave`), `request_changes` withdraws the
   * review, puts the person's comment on the timeline and starts the
   * workflow again, which reads it as operator feedback. Only a task in
   * review has a decision to make (409 `TASK_NOT_IN_REVIEW` otherwise).
   */
  app.post('/projects/:id/tasks/:taskId/review', async (c) => {
    const body = await parseBody(c, taskReviewBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = c.req.param('id');
      const taskId = c.req.param('taskId');
      await loadVisibleTask(deps.sql, auth, projectId, taskId, { write: true });
      const actor = await resolveRequestActor(deps.sql, c, body.actor);
      if (actor === null) {
        // The schema requires the actor; this is the type's residual.
        throw new RestRefusal('An actor is required', 400, 'INVALID_BODY');
      }
      const workflowSlug = body.workflowSlug;
      if (body.decision === 'request_changes' && workflowSlug !== undefined) {
        await assertDeployedAutomation(
          deps.sql,
          auth.organizationId,
          workflowSlug,
          'deploy it before requesting changes through it',
        );
      }
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const actorAuth = await getProjectAuthContext(
        deps.sql,
        {
          organizationId: auth.organizationId,
          userId: actor.userId,
          role: actor.role,
        },
        actor.email,
      );
      const result = await transactSerializable(deps.sql, async (tx) => {
        // The PERSON's access decides, not the key's: a relayed decision
        // by someone who could not write this task on the board is refused
        // the same way the board would refuse them.
        const task = await loadVisibleTask(tx, actorAuth, projectId, taskId, {
          write: true,
        }).catch(refusedForActor);
        if (task.status !== 'in_review') {
          throw new RestRefusal(
            `The task is ${task.status}, not in review`,
            409,
            'TASK_NOT_IN_REVIEW',
          );
        }
        const review = await getPendingReviewForTask(
          tx,
          auth.organizationId,
          task.id,
        );
        if (body.decision === 'approve') {
          await updateTaskStatus(tx, actorAuth, task.id, 'done');
          return {
            status: 'done' as const,
            approvalId: review?.approvalId ?? null,
            runId: null,
            alreadyRunning: false,
          };
        }
        await addTaskComment(tx, actorAuth, {
          taskId: task.id,
          body: body.comment ?? '',
        });
        await updateTaskStatus(tx, actorAuth, task.id, 'in_progress');
        const started = await startWorkflowForTaskInTx(tx, {
          organizationId: auth.organizationId,
          task: { ...task, status: 'in_progress' },
          workflowSlug: workflowSlug ?? '',
          startedByUserId: actor.userId,
          startedVia: 'api-key',
        });
        return {
          status: 'in_progress' as const,
          approvalId: review?.approvalId ?? null,
          runId: started?.runId ?? null,
          alreadyRunning: started?.alreadyRunning ?? false,
        };
      });
      await deps.sql.begin(async (tx) => {
        await createAuditLog(tx, {
          organizationId: auth.organizationId,
          actorId: actor.userId,
          actorEmail: actor.email,
          actorType: 'user',
          action: 'task.review_relayed',
          category: 'data',
          resourceType: 'task',
          resourceId: taskId,
          newState: { decision: body.decision, status: result.status },
          metadata: {
            via: 'api-key',
            keyHolderUserId: c.get('userId'),
            ...(result.approvalId !== null
              ? { approvalId: result.approvalId }
              : {}),
            ...(result.runId !== null ? { runId: result.runId } : {}),
          },
          status: 'success',
        });
      });
      return c.json({
        task: { id: taskId, status: result.status },
        decision: body.decision,
        approvalId: result.approvalId,
        actorUserId: actor.userId,
        ...(body.decision === 'request_changes'
          ? {
              started: result.runId !== null && !result.alreadyRunning,
              ...runRef(result.runId),
            }
          : {}),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });
  return app;
}
