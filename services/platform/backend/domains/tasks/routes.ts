import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  getProjectAuthContext,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { cancelAgentRun, listAgentRunsForTask } from './agent-runs.ts';
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listTaskComments,
  TASK_COMMENT_MAX,
} from './comments.ts';
import {
  getPendingReviewForTask,
  respondToTaskReview,
  TaskReviewError,
} from './reviews.ts';
import {
  addTaskDependency,
  archiveTask,
  assignTask,
  claimTask,
  createTask,
  createTaskLabel,
  deleteBoardView,
  deleteTask,
  deleteTaskLabel,
  getTask,
  listBoardViews,
  listSubtasks,
  listTaskActivity,
  listTaskDependencies,
  listTaskLabels,
  listTasksByProject,
  moveTask,
  removeTaskDependency,
  renameTaskLabel,
  restoreTask,
  saveBoardView,
  TaskError,
  updateTask,
  updateTaskStatus,
  assertTaskReadable,
  assertTaskWritable,
  loadTaskOrThrow,
} from './service.ts';

const statusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
]);
const prioritySchema = z.enum(['p0', 'p1', 'p2', 'p3']);
const assigneeTypeSchema = z.enum(['user', 'agent', 'app']);

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  labels: z.array(z.string()).max(100).optional(),
  assigneeType: assigneeTypeSchema.optional(),
  assigneeId: z.string().optional(),
  parentTaskId: z.string().optional(),
  startDate: z.number().int().positive().optional(),
  dueDate: z.number().int().positive().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(50_000).nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  labels: z.array(z.string()).max(100).optional(),
  startDate: z.number().int().positive().nullable().optional(),
  dueDate: z.number().int().positive().nullable().optional(),
  reviewerUserId: z.string().nullable().optional(),
});

const moveSchema = z.object({
  status: statusSchema,
  beforeRank: z.string().max(200).optional(),
  afterRank: z.string().max(200).optional(),
});

const assignSchema = z.object({
  assigneeType: assigneeTypeSchema.optional(),
  assigneeId: z.string().optional(),
});

const dependencySchema = z.object({
  blockerTaskId: z.string().min(1),
  blockedTaskId: z.string().min(1),
});

const boardViewSchema = z.object({
  projectId: z.string().min(1),
  viewId: z.string().optional(),
  name: z.string().min(1).max(120),
  scope: z.enum(['personal', 'shared']),
  viewType: z.enum(['board', 'table', 'timeline']),
  filters: z.record(z.string(), z.unknown()),
  sort: z.object({ field: z.string().max(60), desc: z.boolean() }).optional(),
  isDefault: z.boolean().optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof TaskReviewError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof TaskError || error instanceof ProjectError) {
    return c.json(
      {
        error: error.code,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
      error.status,
    );
  }
  if (error instanceof RateLimitExceededError) {
    return c.json(
      { error: 'RATE_LIMITED', data: { retryAfterMs: error.retryAfter } },
      429,
    );
  }
  throw error;
}

/** /api/app/tasks — the task board surface (session + org-member gated). */
export function createTaskRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const authCtx = (c: Context<OrgEnv>): Promise<ProjectAuthContext> =>
    getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );

  app.get('/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      const includeArchived = c.req.query('includeArchived') === 'true';
      return c.json({
        tasks: await listTasksByProject(
          deps.sql,
          auth,
          c.req.param('projectId'),
          { includeArchived },
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/labels/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        labels: await listTaskLabels(deps.sql, auth, c.req.param('projectId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/labels', async (c) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(100),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const labelId = await transactSerializable(deps.sql, (tx) =>
        createTaskLabel(tx, auth, body.data),
      );
      return c.json({ labelId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/labels/:labelId/rename', async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(100) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        renameTaskLabel(tx, auth, {
          labelId: c.req.param('labelId'),
          name: body.data.name,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/labels/:labelId', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteTaskLabel(tx, auth, c.req.param('labelId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/board-views/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        views: await listBoardViews(deps.sql, auth, c.req.param('projectId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/board-views', async (c) => {
    const body = boardViewSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const viewId = await transactSerializable(deps.sql, (tx) =>
        saveBoardView(tx, auth, body.data),
      );
      return c.json({ viewId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/board-views/:viewId', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteBoardView(tx, auth, c.req.param('viewId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/dependencies', async (c) => {
    const body = dependencySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        addTaskDependency(tx, auth, body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/dependencies', async (c) => {
    const body = dependencySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        removeTaskDependency(tx, auth, body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const body = createTaskSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkUserRateLimit(deps.sql, 'task:create', auth.userId);
      const taskId = await transactSerializable(deps.sql, (tx) =>
        createTask(tx, auth, body.data),
      );
      return c.json({ taskId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(await getTask(deps.sql, auth, c.req.param('taskId')));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/comments', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        comments: await listTaskComments(deps.sql, auth, c.req.param('taskId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/comments', async (c) => {
    const body = z
      .object({ body: z.string().min(1).max(TASK_COMMENT_MAX) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkUserRateLimit(deps.sql, 'task:comment', auth.userId);
      const result = await transactSerializable(deps.sql, (tx) =>
        addTaskComment(tx, auth, {
          taskId: c.req.param('taskId'),
          body: body.data.body,
        }),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/comments/:messageId', async (c) => {
    const body = z
      .object({ body: z.string().min(1).max(TASK_COMMENT_MAX) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        editTaskComment(tx, auth, {
          messageId: c.req.param('messageId'),
          body: body.data.body,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/comments/:messageId', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteTaskComment(tx, auth, c.req.param('messageId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/subtasks', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        subtasks: await listSubtasks(deps.sql, auth, c.req.param('taskId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/activity', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        activity: await listTaskActivity(deps.sql, auth, c.req.param('taskId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/dependencies', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await listTaskDependencies(deps.sql, auth, c.req.param('taskId')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId', async (c) => {
    const body = updateTaskSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateTask(tx, auth, { taskId: c.req.param('taskId'), ...body.data }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/agent-runs', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(deps.sql, c.req.param('taskId'));
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskReadable(project, auth);
      const runs = await listAgentRunsForTask(
        deps.sql,
        auth.organizationId,
        task.id,
      );
      return c.json({ runs });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/agent-runs/:runId/cancel', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(deps.sql, c.req.param('taskId'));
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskWritable(project, auth);
      const cancelled = await cancelAgentRun(deps.sql, {
        organizationId: auth.organizationId,
        runId: c.req.param('runId'),
      });
      return c.json({ cancelled });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The task's open review gate (null when nothing waits on a reviewer).
  app.get('/:taskId/review', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        review: await getPendingReviewForTask(
          deps.sql,
          auth.organizationId,
          c.req.param('taskId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // A reviewer decides: approve completes the task as the responder;
  // request-changes records the feedback and hands the work back.
  app.post('/reviews/:approvalId/respond', async (c) => {
    const body = z
      .object({
        decision: z.enum(['approve', 'request_changes']),
        feedback: z.string().max(20_000).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      return c.json(
        await respondToTaskReview(deps.sql, {
          auth,
          approvalId: c.req.param('approvalId'),
          decision: body.data.decision,
          ...(body.data.feedback !== undefined
            ? { feedback: body.data.feedback }
            : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/status', async (c) => {
    const body = z
      .object({ status: statusSchema })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateTaskStatus(tx, auth, c.req.param('taskId'), body.data.status),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/move', async (c) => {
    const body = moveSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        moveTask(tx, auth, { taskId: c.req.param('taskId'), ...body.data }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/assign', async (c) => {
    const body = assignSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        assignTask(tx, auth, { taskId: c.req.param('taskId'), ...body.data }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/claim', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        claimTask(tx, auth, c.req.param('taskId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/archive', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        archiveTask(tx, auth, c.req.param('taskId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/restore', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        restoreTask(tx, auth, c.req.param('taskId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:taskId', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteTask(tx, auth, c.req.param('taskId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
