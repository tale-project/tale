import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { resolveTaskServing } from '../../core/tasks/task_serving.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { cancelRunInTx } from '../automations/store.ts';
import { MentionDirectoryError } from '../collab/mention-directory.ts';
import { getOrCreateProjectFolder } from '../folders/service.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import {
  getProjectAuthContext,
  listProjects,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  cancelAgentRun,
  getAgentRun,
  getAgentRunSandboxOp,
  getLatestAgentRunCardForTask,
  listAgentRunsForTask,
} from './agent-runs.ts';
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listTaskComments,
  TASK_COMMENT_MAX,
  TASK_COMMENT_PAGE_MAX,
  taskCommentCursorSchema,
} from './comments.ts';
import {
  findLiveAutomationRunForTask,
  startWorkflowForTask,
  upsertTaskByExternalRef,
} from './external-ref.ts';
import {
  collectPendingReviewsForProjects,
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
  ensureDefaultProjectLabels,
  getTask,
  getTaskOpsIndicators,
  getTaskOpsIndicatorsForAccessibleProjects,
  listBoardViews,
  listSubtasks,
  listTaskActivity,
  listTaskDependencies,
  listProjectDependencies,
  listTaskLabels,
  listTasksByProject,
  listTasksForAccessibleProjects,
  moveTask,
  removeTaskDependency,
  renameTaskLabel,
  bulkUpdateTasks,
  mentionTriggerPreview,
  restoreTask,
  saveBoardView,
  searchTasks,
  startTaskAgentRunManual,
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
  beforeTaskId: z.string().max(128).optional(),
  afterTaskId: z.string().max(128).optional(),
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
    return rateLimitedResponse(c, error);
  }
  // A comment whose @mentions could not be resolved is NOT posted — the
  // author sees a retryable failure instead of a comment that silently
  // notified nobody.
  if (error instanceof MentionDirectoryError) {
    return c.json({ error: error.code }, error.status);
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

  // What an UNPINNED project-agent model pick would run on RIGHT NOW — the
  // task resolver's direct-only walk (it intentionally differs from the
  // workflow lane's). A resolution failure is a RESULT, not an error.
  app.get('/serving-preview', async (c) => {
    const organizationId = c.get('orgId');
    const model = c.req.query('model') ?? '';
    const harness = c.req.query('harness') ?? '';
    if (model.length === 0 || harness.length === 0) {
      return c.json({ error: 'model and harness are required' }, 400);
    }
    // The knowledge shim = credential reads + the better-auth org lookup the
    // provider walk resolves slugs through.
    const shim = createCtxShim(knowledgeShimHandlers(deps.sql));
    try {
      const serving = await resolveTaskServing(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 resolver; its ctx facilities (org lookup + default-credential read) are covered by knowledgeShimHandlers
        shim as unknown as Parameters<typeof resolveTaskServing>[0],
        {
          organizationId,
          model,
          harness,
        },
      );
      return c.json({
        ok: true as const,
        providerSlug: serving.providerSlug,
        modelId: serving.modelId,
        lane: serving.lane,
      });
    } catch (error) {
      return c.json({
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /** The shared board filter set, straight off the query string. */
  const boardFilters = (c: Context<OrgEnv>) => {
    const statuses = c.req.query('statuses');
    return {
      includeArchived: c.req.query('includeArchived') === 'true',
      ...(c.req.query('status') !== undefined
        ? { status: c.req.query('status') }
        : {}),
      ...(statuses !== undefined && statuses.length > 0
        ? { statuses: statuses.split(',') }
        : {}),
      ...(c.req.query('assigneeId') !== undefined
        ? { assigneeId: c.req.query('assigneeId') }
        : {}),
      ...(c.req.query('externalSystem') !== undefined
        ? { externalSystem: c.req.query('externalSystem') }
        : {}),
    };
  };

  app.get('/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await listTasksByProject(
          deps.sql,
          auth,
          c.req.param('projectId'),
          boardFilters(c),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The all-projects board: every task in projects the caller can read.
  app.get('/', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await listTasksForAccessibleProjects(deps.sql, auth, boardFilters(c)),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The board's ops chips: working pulse / needs-answer / pending reviews.
  // Fixed paths sit BEFORE `/:taskId` so they never read as task ids.
  app.get('/ops-indicators/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await getTaskOpsIndicators(deps.sql, auth, c.req.param('projectId')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/ops-indicators', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await getTaskOpsIndicatorsForAccessibleProjects(deps.sql, auth),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Token-AND search over fields + a comment fallback (palette + toolbar).
  app.get('/search', async (c) => {
    try {
      const auth = await authCtx(c);
      const projectId = c.req.query('projectId');
      return c.json({
        results: await searchTasks(deps.sql, auth, {
          query: c.req.query('q') ?? '',
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Per mentioned agent slug: would saving put it to work — and if not, why.
  app.get('/mention-preview', async (c) => {
    try {
      const auth = await authCtx(c);
      const taskId = c.req.query('taskId');
      const projectId = c.req.query('projectId');
      const slugs = (c.req.query('slugs') ?? '')
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0);
      return c.json({
        previews: await mentionTriggerPreview(deps.sql, auth, {
          ...(taskId !== undefined ? { taskId } : {}),
          ...(projectId !== undefined ? { projectId } : {}),
          slugs,
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The multi-select bar: one patch over many tasks, per-task skips.
  app.post('/bulk', async (c) => {
    const body = z
      .object({
        taskIds: z.array(z.string().min(1)).max(200),
        status: statusSchema.optional(),
        priority: prioritySchema.nullable().optional(),
        assigneeType: assigneeTypeSchema.optional(),
        assigneeId: z.string().optional(),
        clearAssignee: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        bulkUpdateTasks(tx, auth, body.data),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Template create: materialize a task from an external subject (the desk
  // flow) — optionally minting the subject ROOT FOLDER in the same gesture.
  app.post('/from-external-issue', async (c) => {
    const body = z
      .object({
        projectId: z.string().min(1).optional(),
        externalSystem: z.string().min(1).max(100),
        externalId: z.string().max(512).optional(),
        ensureFolder: z
          .object({
            name: z.string().min(1).max(255),
            setupFolderName: z.string().max(255).optional(),
          })
          .optional(),
        title: z.string().min(1).max(500),
        externalUrl: z.string().max(2048).optional(),
        description: z.string().max(50_000).optional(),
        labels: z.array(z.string()).max(100).optional(),
        runWorkflowSlug: z.string().max(200).optional(),
        automationSlug: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const args = body.data;
    if (!args.externalId === !args.ensureFolder) {
      return c.json(
        {
          error: 'INVALID_ARGUMENTS',
          message: 'Provide exactly one of externalId or ensureFolder',
        },
        400,
      );
    }
    if (args.ensureFolder && !args.projectId) {
      return c.json(
        {
          error: 'INVALID_ARGUMENTS',
          message: 'ensureFolder requires an explicit projectId',
        },
        400,
      );
    }
    try {
      const auth = await authCtx(c);
      // Project-scoped apps pass their bound project; without one, fall back
      // to the org-wide project (warned) — never silently guess a user one.
      let projectId: string;
      if (args.projectId !== undefined) {
        const project = await loadProjectOrThrow(deps.sql, args.projectId);
        assertTaskReadable(project, auth);
        projectId = project.id;
      } else {
        const projects = await listProjects(deps.sql, auth);
        const fallback =
          projects.find((project) => project.isOrgWide) ?? projects[0];
        if (!fallback) {
          return c.json(
            { error: 'NO_PROJECT', message: 'Create a project first' },
            400,
          );
        }
        console.warn(
          '[create-task] no projectId supplied; falling back to org-wide project',
          { organizationId: auth.organizationId, projectId: fallback.id },
        );
        projectId = fallback.id;
      }

      const result = await transactSerializable(deps.sql, async (tx) => {
        // Folder-driven flow: the folder IS the external subject; the setup
        // folder's id rides externalUrl (the desks' binding convention) and
        // its absence fails closed.
        let externalId = args.externalId;
        let externalUrl = args.externalUrl;
        let ensuredFolderId: string | undefined;
        if (args.ensureFolder) {
          const folder = await getOrCreateProjectFolder(tx, auth, {
            projectId,
            name: args.ensureFolder.name,
          });
          externalId = folder.folderId;
          ensuredFolderId = folder.folderId;
          const setupName = args.ensureFolder.setupFolderName;
          if (setupName !== undefined && externalUrl === undefined) {
            const setup = await tx<{ id: string }[]>`
              SELECT id FROM app.folders
              WHERE org_id = ${auth.organizationId}
                AND project_id = ${projectId}
                AND parent_id IS NULL
                AND lower(name) = ${setupName.trim().toLowerCase()}
              LIMIT 1
            `;
            if (setup.length === 0) {
              throw new TaskError(
                'SETUP_FOLDER_MISSING',
                `Folder "${setupName}" does not exist in this project yet`,
              );
            }
            externalUrl = setup[0]?.id;
          }
        }
        if (externalId === undefined) {
          throw new TaskError(
            'INVALID_ARGUMENTS',
            'externalId did not resolve',
          );
        }
        const upserted = await upsertTaskByExternalRef(tx, {
          organizationId: auth.organizationId,
          actorId: auth.userId,
          projectId,
          externalSystem: args.externalSystem,
          externalId,
          title: args.title,
          ...(externalUrl !== undefined ? { externalUrl } : {}),
          ...(args.description !== undefined
            ? { description: args.description }
            : {}),
          ...(args.labels !== undefined ? { labels: args.labels } : {}),
          externalState: 'open',
          // The authenticated member is the CREATOR; the owning automation
          // becomes the ASSIGNEE (the upsert's worker-class attribution).
          creatorType: 'user',
          ...(args.runWorkflowSlug !== undefined
            ? { runWorkflowSlug: args.runWorkflowSlug }
            : {}),
          ...(args.automationSlug !== undefined
            ? { automationSlug: args.automationSlug }
            : {}),
          dedupeScope: args.projectId !== undefined ? 'project' : 'org',
        });
        return { upserted, ensuredFolderId };
      });
      const taskId = result.upserted.taskId;
      if (taskId === null) {
        return c.json(
          { error: 'TASK_CREATE_FAILED', message: 'Task did not materialize' },
          400,
        );
      }
      let executionId: string | null | undefined;
      if (args.runWorkflowSlug !== undefined && result.upserted.created) {
        const task = await loadTaskOrThrow(
          deps.sql,
          taskId,
          auth.organizationId,
        );
        const started = await startWorkflowForTask(deps.sql, {
          organizationId: auth.organizationId,
          task,
          workflowSlug: args.runWorkflowSlug,
          startedByUserId: auth.userId,
        });
        executionId = started?.runId ?? null;
      }
      return c.json({
        taskId,
        created: result.upserted.created,
        ...(executionId !== undefined ? { executionId } : {}),
        ...(result.ensuredFolderId !== undefined
          ? { folderId: result.ensuredFolderId }
          : {}),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The run card's live sandbox transcript — fail-closed null (0.4 wire).
  app.get('/agent-runs/:runId/sandbox-op', async (c) => {
    try {
      const auth = await authCtx(c);
      const loaded = await getAgentRunSandboxOp(
        deps.sql,
        auth.organizationId,
        c.req.param('runId'),
      );
      if (loaded === null) return c.json({ op: null });
      try {
        const project = await loadProjectOrThrow(deps.sql, loaded.projectId);
        assertTaskReadable(project, auth);
      } catch (error) {
        console.warn('[tasks] agent-run op access refused', error);
        return c.json({ op: null });
      }
      return c.json({ op: loaded.op });
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
        deleteTaskLabel(tx, auth, {
          labelId: c.req.param('labelId'),
          detach: c.req.query('detach') === 'true',
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Idempotent default-catalog seed (the 0.4 board bootstrap safeguard).
  app.post('/labels/ensure-defaults', async (c) => {
    const body = z
      .object({ projectId: z.string().min(1) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, async (tx) => {
        const project = await loadProjectOrThrow(tx, body.data.projectId);
        assertTaskWritable(project, auth);
        await ensureDefaultProjectLabels(tx, {
          organizationId: auth.organizationId,
          projectId: body.data.projectId,
          createdBy: auth.userId,
        });
      });
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

  // The board's review chips: pending review gates across the given
  // projects (bounded org-level read).
  app.get('/pending-reviews', async (c) => {
    const raw = c.req.query('projectIds') ?? '';
    const projectIds = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 100);
    try {
      const auth = await authCtx(c);
      return c.json({
        reviews: await collectPendingReviewsForProjects(
          deps.sql,
          auth.organizationId,
          projectIds,
        ),
      });
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

  /** The discussion, newest page first — the page envelope the infinite-
   * query lane walks (`cursor` = the previous page's `continueCursor`, an
   * older page each time), so a busy task's freshest comment is always on
   * the first page and no fixed window ever hides the rest. */
  app.get('/:taskId/comments', async (c) => {
    const query = z
      .object({
        numItems: z.coerce
          .number()
          .int()
          .min(1)
          .max(TASK_COMMENT_PAGE_MAX)
          .optional(),
        cursor: taskCommentCursorSchema,
      })
      .safeParse({
        numItems: c.req.query('numItems'),
        cursor: c.req.query('cursor'),
      });
    if (!query.success) {
      return c.json({ error: 'invalid query' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const page = await listTaskComments(
        deps.sql,
        auth,
        c.req.param('taskId'),
        {
          ...(query.data.numItems !== undefined
            ? { limit: query.data.numItems }
            : {}),
          ...(query.data.cursor !== undefined
            ? { before: query.data.cursor }
            : {}),
        },
      );
      return c.json({
        // The lazily-created thread id (null = the threadless-task
        // bootstrap) beside the page, newest comment first.
        threadId: task.discussionThreadId,
        page: page.comments.reverse(),
        isDone: !page.hasMore,
        continueCursor: page.nextCursor === null ? '' : String(page.nextCursor),
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

  app.get('/dependencies/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        edges: await listProjectDependencies(
          deps.sql,
          auth,
          c.req.param('projectId'),
        ),
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
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
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

  // The detail sheet's newest-run card — null when no run has ever kicked.
  app.get('/:taskId/agent-runs/latest', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskReadable(project, auth);
      return c.json({
        run: await getLatestAgentRunCardForTask(
          deps.sql,
          auth.organizationId,
          task.id,
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The subject-linked live automation run banner.
  app.get('/:taskId/live-automation-run', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskReadable(project, auth);
      return c.json({
        run: await findLiveAutomationRunForTask(deps.sql, {
          organizationId: auth.organizationId,
          projectId: task.projectId,
          taskId: task.id,
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The manual "Run agent" kick — refusals answer as data (0.4 wire).
  app.post('/:taskId/agent-runs/start', async (c) => {
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        startTaskAgentRunManual(tx, auth, c.req.param('taskId')),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Start a DEPLOYED automation with this task as its subject (desk Start).
  app.post('/:taskId/workflow/start', async (c) => {
    const body = z
      .object({ workflowSlug: z.string().min(1).max(200) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      // Starting a run is a WRITE (it spends budget and moves the card) —
      // same gate as the manual agent-run kick, not the read-level banner.
      assertTaskWritable(project, auth);
      const started = await startWorkflowForTask(deps.sql, {
        organizationId: auth.organizationId,
        task,
        workflowSlug: body.data.workflowSlug,
        startedByUserId: auth.userId,
      });
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
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Cancel the in-flight subject-linked run (if any), then park the task at
  // `cancelled` so desk Start can re-trigger. Idempotent when idle.
  app.post('/:taskId/workflow/cancel', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      // The WRITE gate must precede the run cancel: `updateTaskStatus` below
      // asserts writable too, but by then the live run would already be dead
      // — a read-only member must be refused before any side effect.
      assertTaskWritable(project, auth);
      const live = await findLiveAutomationRunForTask(deps.sql, {
        organizationId: auth.organizationId,
        projectId: task.projectId,
        taskId: task.id,
      });
      // ONE transaction for the run cancel and the status flip: if the flip
      // refuses (open subtasks, archived), the cancel rolls back with it —
      // never a dead run behind a task that answered an error.
      const executionCancelled = await transactSerializable(
        deps.sql,
        async (tx) => {
          const cancelled =
            live === null
              ? false
              : (await cancelRunInTx(tx, auth.organizationId, live.runId))
                  .cancelled;
          if (task.status !== 'cancelled') {
            await updateTaskStatus(tx, auth, task.id, 'cancelled');
          }
          return cancelled;
        },
      );
      return c.json({
        taskCancelled: true,
        executionCancelled,
        executionId: live?.runId ?? null,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Cancel the task's LIVE run (the 0.4 wire carries only the taskId).
  app.post('/:taskId/agent-runs/cancel-live', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskWritable(project, auth);
      const live = await deps.sql<{ id: string }[]>`
        SELECT id FROM app.project_agent_runs
        WHERE task_id = ${task.id} AND status IN ('queued', 'running')
        ORDER BY started_at_ms DESC
        LIMIT 1
      `;
      const runId = live[0]?.id;
      const cancelled =
        runId === undefined
          ? false
          : await cancelAgentRun(deps.sql, {
              organizationId: auth.organizationId,
              runId,
              taskId: task.id,
            });
      return c.json({ cancelled });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/agent-runs/:runId/cancel', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      assertTaskWritable(project, auth);
      // Write access was asserted on the URL's task, so the run must be THAT
      // task's: a run id lifted from another project's task (one the caller
      // may not even read) answers as missing — the same opaque 404 a garbage
      // id gets, so probing confirms nothing. The cancel itself binds to the
      // task once more inside its UPDATE predicate.
      const run = await getAgentRun(
        deps.sql,
        auth.organizationId,
        c.req.param('runId'),
      );
      if (run === null || run.taskId !== task.id) {
        throw new TaskError('AGENT_RUN_NOT_FOUND', 'Agent run not found', 404);
      }
      const cancelled = await cancelAgentRun(deps.sql, {
        organizationId: auth.organizationId,
        runId: run.id,
        taskId: task.id,
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
      const result = await transactSerializable(deps.sql, (tx) =>
        claimTask(tx, auth, c.req.param('taskId')),
      );
      return c.json(result);
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
      const result = await transactSerializable(deps.sql, (tx) =>
        deleteTask(tx, auth, c.req.param('taskId')),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
