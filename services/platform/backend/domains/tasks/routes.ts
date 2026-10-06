import { transactSerializable } from '@tale/shared/db/serializable';
import { configurationHashSchema } from '@tale/shared/schemas/configuration';
import { epochMsSchema } from '@tale/shared/schemas/epoch-ms';
import { managedTaskInstructionsSchema } from '@tale/shared/schemas/managed-configuration';
import { externalStatusRequestBodySchema } from '@tale/shared/schemas/task-external-status';
import { setTaskReviewerInputSchema } from '@tale/shared/schemas/task-review';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { taskRepeatSchema } from '../../../lib/shared/task-repeat.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import {
  importedTaskTitleRefusal,
  TASK_ATTACHMENTS_MAX,
  taskCommentRefusal,
  taskDescriptionRefusal,
  taskLabelCountRefusal,
  taskLabelNameRefusal,
  taskTitleRefusal,
} from '../../core/tasks/helpers.ts';
import { resolveTaskServing } from '../../core/tasks/task_serving.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import {
  invalidBodyResponse,
  invalidBodyIssuesResponse,
} from '../../lib/invalid-body-response.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { AutomationError, cancelRunInTx } from '../automations/store.ts';
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
  getAgentRunSandboxOp,
  getLatestAgentRunCardForTask,
  listAgentRunsForTask,
} from './agent-runs.ts';
import { assertAutomationForTask } from './automation-access.ts';
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
  listTaskComments,
  TASK_COMMENT_PAGE_MAX,
  taskCommentCursorSchema,
} from './comments.ts';
import {
  findLatestAutomationRunForTask,
  findLiveAutomationRunForTask,
  findTaskByExternalRef,
  resolveSetupFolderId,
  startWorkflowForTask,
  startWorkflowForTaskInTx,
  upsertTaskByExternalRef,
} from './external-ref.ts';
import {
  readTaskStatusSnapshot,
  requestExternalTaskStatus,
} from './external-status.ts';
import { getProjectTaskMetrics } from './metrics.ts';
import { stopTaskRepeat, type TaskRepeatCopy } from './repeat.ts';
import { TaskReviewError } from './reviews.ts';
import {
  addTaskDependency,
  archiveTask,
  assertTaskCreatable,
  assertTaskLabelsEditable,
  assertTaskWorkable,
  assignTask,
  boardTaskAccess,
  createTask,
  createTaskLabel,
  deleteTask,
  deleteTaskLabel,
  ensureDefaultProjectLabels,
  getTask,
  getTaskReviewer,
  setTaskReviewer,
  getTaskOpsIndicators,
  getTaskOpsIndicatorsForAccessibleProjects,
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
  mentionTriggerPreview,
  restoreTask,
  searchTasks,
  startTaskAgentRunManual,
  TaskError,
  updateTask,
  updateTaskStatus,
  assertTaskReadable,
  assertTaskNotArchived,
  liveAgentRunOfTask,
  loadTaskOrThrow,
  readTaskInstructionsConfiguration,
  updateTaskInstructionsConfiguration,
  mayWorkTask,
} from './service.ts';
import { listTasksFromThread } from './source-thread.ts';

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

/** One attachment as the dialog sends it (`stripPreviews`): the blob ref
 * and the display trio. Ownership of the ref is the service's check. */
const taskAttachmentSchema = z.object({
  fileId: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  fileType: z.string().max(255),
  fileSize: z.number().int().min(0),
});
const attachmentsSchema = z
  .array(taskAttachmentSchema)
  .max(TASK_ATTACHMENTS_MAX)
  .optional();

/** The param a {@link refusedAsDomain} issue carries its domain code in. */
const DOMAIN_REFUSAL_CODE = 'domainRefusalCode';

/**
 * A field the domain caps, checked AT THE SCHEMA with the domain's own
 * refusal: the sentence, under the code, that `validateTitle`,
 * `validateDescription`, `normalizeLabelNames` and the comment writers throw
 * (the shared `task*Refusal` helpers). The door answers it as the domain
 * does ({@link invalidBody}) — before a rate-limit slot is charged or a row
 * is read, and however far past the cap the value is. The schema used to
 * carry caps of its own above the domain's (a title ≤ 500, a description ≤
 * 50,000, ≤ 100 labels, a label name ≤ 100, a comment `.min(1)`), and a
 * value one of those refused answered a bare `invalid body` that named no
 * limit and could not tell an empty title or comment from an over-long one.
 * The domain keeps its own check: the REST and agent doors reach it without
 * this schema.
 */
function refusedAsDomain<T>(
  schema: z.ZodType<T>,
  code: string,
  refusal: (value: T) => string | null,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    const message = refusal(value);
    if (message !== null) {
      ctx.addIssue({
        code: 'custom',
        message,
        params: { [DOMAIN_REFUSAL_CODE]: code },
      });
    }
  });
}

const titleSchema = refusedAsDomain(
  z.string(),
  'TASK_TITLE_INVALID',
  taskTitleRefusal,
);
const descriptionSchema = refusedAsDomain(
  z.string(),
  'TASK_DESCRIPTION_INVALID',
  taskDescriptionRefusal,
);
// How MANY labels; each name's length is the domain's to refuse, with its
// own sentence (`normalizeLabelNames`), which `handleError` relays.
const labelsSchema = refusedAsDomain(
  z.array(z.string()),
  'TASK_LABELS_INVALID',
  (labels) => taskLabelCountRefusal(labels.length),
);
// One catalog label's name, as the label create and rename take it.
const labelNameSchema = refusedAsDomain(
  z.string(),
  'TASK_LABELS_INVALID',
  taskLabelNameRefusal,
);
// The title of an imported task: only a blank one is refused. Its length is
// the domain's to decide, and the upsert cuts it (`truncateImportedTitle`).
const importedTitleSchema = refusedAsDomain(
  z.string(),
  'TASK_TITLE_INVALID',
  importedTaskTitleRefusal,
);
const commentBodySchema = z.object({
  body: refusedAsDomain(z.string(), 'TASK_COMMENT_INVALID', taskCommentRefusal),
});

/** A body the schema refused: the domain's code and sentence when a field
 * broke one of its caps ({@link refusedAsDomain}), else `invalid body`. */
function invalidBody<E extends OrgEnv>(
  c: Context<E>,
  error: z.ZodError,
): Response {
  for (const issue of error.issues) {
    const code: unknown =
      issue.code === 'custom' ? issue.params?.[DOMAIN_REFUSAL_CODE] : undefined;
    if (typeof code === 'string') {
      return c.json({ error: code, message: issue.message }, 400);
    }
  }
  return invalidBodyResponse(c, error);
}

/** A start or due date: an instant a `Date` can hold, which a safe integer
 * alone is not (`9e15` stored, and the card and the date picker had nothing
 * to render). Zero stays refused, as it always was: the board reads a zero
 * date as none. */
const taskDateSchema = epochMsSchema.positive();

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: titleSchema,
  description: descriptionSchema.optional(),
  attachments: attachmentsSchema,
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  labels: labelsSchema.optional(),
  assigneeType: assigneeTypeSchema.optional(),
  assigneeId: z.string().optional(),
  parentTaskId: z.string().optional(),
  startDate: taskDateSchema.optional(),
  dueDate: taskDateSchema.optional(),
  repeat: taskRepeatSchema.optional(),
  /** The conversation the task is handed over from (its root thread). */
  sourceThreadId: z.string().min(1).max(128).optional(),
});

const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  attachments: attachmentsSchema,
  priority: prioritySchema.nullable().optional(),
  labels: labelsSchema.optional(),
  startDate: taskDateSchema.nullable().optional(),
  dueDate: taskDateSchema.nullable().optional(),
  reviewerUserId: z.string().nullable().optional(),
  /** null is "does not repeat". */
  repeat: taskRepeatSchema.nullable().optional(),
});

const moveSchema = z.object({
  status: statusSchema,
  beforeTaskId: z.string().max(128).optional(),
  afterTaskId: z.string().max(128).optional(),
});

/** Where a stopped workflow's task lands: Cancelled when nothing says
 * otherwise (the run's own Cancel, a hand-off), else the column a person
 * moved the card to, and where in it. In progress is the column a stop
 * leaves, never one it lands in. */
const workflowStopSchema = moveSchema.extend({
  status: statusSchema.exclude(['in_progress']).default('cancelled'),
});

const assignSchema = z.object({
  assigneeType: assigneeTypeSchema.optional(),
  assigneeId: z.string().optional(),
});

const dependencySchema = z.object({
  blockerTaskId: z.string().min(1),
  blockedTaskId: z.string().min(1),
});

/** A status door's answer: the next copy rides along when the move closed a
 * repeating task, so the board can say where the series went. */
function statusMoved(nextTask: TaskRepeatCopy | null): {
  ok: true;
  nextTask?: TaskRepeatCopy;
} {
  return nextTask === null ? { ok: true } : { ok: true, nextTask };
}

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ConfigurationError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof TaskReviewError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  // The domain's own sentence rides beside the code, as every app door
  // answers a coded refusal: it is what names the limit a value broke (an
  // empty title against an over-long one) — the code alone told the client
  // that the body was refused, never why.
  if (error instanceof TaskError || error instanceof ProjectError) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
      error.status,
    );
  }
  // The workflow start door surfaces the automation's own refusal (a
  // project it is not bound to) instead of laundering it into "not started".
  if (error instanceof AutomationError) {
    return c.json({ error: error.code, message: error.message }, error.status);
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

  app.get('/:taskId/external-status', async (c) => {
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      assertTaskReadable(
        await loadProjectOrThrow(deps.sql, task.projectId),
        auth,
      );
      return c.json(
        await readTaskStatusSnapshot(deps.sql, auth.organizationId, task.id),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/external-status-request', async (c) => {
    const body = externalStatusRequestBodySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await authCtx(c);
      return c.json(
        await transactSerializable(deps.sql, (tx) =>
          requestExternalTaskStatus(tx, auth, c.req.param('taskId'), body.data),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:taskId/configuration/instructions', async (c) => {
    const target = managedTaskInstructionsSchema
      .omit({ description: true })
      .safeParse({
        projectId: c.req.query('projectId'),
        taskId: c.req.param('taskId'),
      });
    if (!target.success) return invalidBodyResponse(c, target.error);
    try {
      return c.json(
        await readTaskInstructionsConfiguration(
          deps.sql,
          await authCtx(c),
          target.data.projectId,
          target.data.taskId,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/configuration/instructions', async (c) => {
    const body = z
      .strictObject({
        config: managedTaskInstructionsSchema,
        expectedHash: configurationHashSchema,
      })
      .safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    if (
      body.data.config.projectId !== c.req.query('projectId') ||
      body.data.config.taskId !== c.req.param('taskId')
    )
      return invalidBodyIssuesResponse(c, [
        {
          path: 'config',
          message: 'must name the resource in the request path and query',
        },
      ]);
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateTaskInstructionsConfiguration(
          tx,
          auth,
          body.data.config,
          body.data.expectedHash,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

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
      ...(c.req.query('reviewerId') !== undefined
        ? { reviewerId: c.req.query('reviewerId') }
        : {}),
      ...(c.req.query('externalSystem') !== undefined
        ? { externalSystem: c.req.query('externalSystem') }
        : {}),
      // The toolbar's search narrows the board read itself (#3745).
      ...(c.req.query('q') !== undefined ? { query: c.req.query('q') } : {}),
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

  // The project metrics page: the window's day rows folded at read time
  // from the live task, run, review and ask rows (see `./metrics.ts`).
  app.get('/metrics/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      const periodRaw = Number(c.req.query('periodDays') ?? '30');
      const periodDays =
        periodRaw === 7
          ? (7 as const)
          : periodRaw === 90
            ? (90 as const)
            : (30 as const);
      return c.json(
        await getProjectTaskMetrics(deps.sql, auth, c.req.param('projectId'), {
          periodDays,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Token-AND search over fields + a comment fallback — the palette. The
  // board narrows its own read with `q` instead (`boardFilters`).
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
        // An import's title and description are cut to the board's caps
        // by the domain, never refused for their length: caps of this
        // door's own (500, 50,000) answered a bare `invalid body` and
        // stored a description no other door could write.
        title: importedTitleSchema,
        externalUrl: z.string().max(2048).optional(),
        description: z.string().optional(),
        labels: labelsSchema.optional(),
        runWorkflowSlug: z.string().max(200).optional(),
        automationSlug: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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
        // Both lanes of the intake need an active project the caller reads,
        // checked before the folder below is minted: creating a task is open
        // to every reader, reconciling the one the reference already names
        // is a change to that task (its work gate, further down).
        const project = await loadProjectOrThrow(tx, projectId);
        assertTaskCreatable(project, auth);
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
            externalUrl = await resolveSetupFolderId(tx, {
              organizationId: auth.organizationId,
              projectId,
              setupFolderName: setupName,
            });
          }
        }
        if (externalId === undefined) {
          throw new TaskError(
            'INVALID_ARGUMENTS',
            'externalId did not resolve',
          );
        }
        const dedupeScope = args.projectId !== undefined ? 'project' : 'org';
        const existing = await findTaskByExternalRef(tx, {
          organizationId: auth.organizationId,
          projectId,
          externalSystem: args.externalSystem,
          externalId,
          dedupeScope,
        });
        if (existing !== null) {
          // An organization-wide reference can name a task in another
          // project, which is judged on its own project.
          const existingProject =
            existing.projectId === project.id
              ? project
              : await loadProjectOrThrow(tx, existing.projectId);
          if (!(await mayWorkTask(tx, existingProject, existing, auth))) {
            // Someone else's subject: picking it again opens it, as it is.
            // Reconciling it would be a change to their task, so nothing
            // is written and nothing starts.
            assertTaskReadable(existingProject, auth);
            return {
              upserted: { taskId: existing.id, created: false },
              ensuredFolderId,
            };
          }
        }
        // The automation a member names must be built for tasks (or own
        // the task being reconciled); editors may name any.
        for (const automation of new Set([
          args.automationSlug,
          args.runWorkflowSlug,
        ])) {
          if (automation === undefined || automation === '') continue;
          await assertAutomationForTask(tx, {
            project,
            auth,
            task: existing,
            automation,
          });
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
          dedupeScope,
          // The label catalog is the project editors' to grow.
          mintLabels: boardTaskAccess(project, auth).canEdit,
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
        // The task is committed; a start that fails after it answers
        // `executionId: null` (the caller starts it by hand) rather than an
        // error that reads as "the task was not created".
        executionId = await startWorkflowForTask(deps.sql, {
          organizationId: auth.organizationId,
          task,
          workflowSlug: args.runWorkflowSlug,
          startedByUserId: auth.userId,
        }).then(
          (started) => started?.runId ?? null,
          (error: unknown) => {
            console.error(
              '[task-workflow] start after create failed',
              args.runWorkflowSlug,
              error,
            );
            return null;
          },
        );
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
        name: labelNameSchema,
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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
      .object({ name: labelNameSchema })
      .safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, async (tx) => {
        const project = await loadProjectOrThrow(tx, body.data.projectId);
        assertTaskLabelsEditable(project, auth);
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

  app.post('/dependencies', async (c) => {
    const body = dependencySchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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
      return invalidBodyResponse(c, body.error);
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
      return invalidBody(c, body.error);
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

  // The tasks made from one conversation, for the chat's own row of them.
  // Registered before the `/:taskId` wildcard.
  app.get('/by-thread/:threadId', async (c) => {
    try {
      const auth = await authCtx(c);
      const tasks = await listTasksFromThread(
        deps.sql,
        auth,
        c.req.param('threadId'),
      );
      return c.json({ tasks });
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
    const body = commentBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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
    const body = commentBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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

  app.get('/:taskId/reviewer', async (c) => {
    try {
      return c.json(
        await getTaskReviewer(
          deps.sql,
          await authCtx(c),
          c.req.param('taskId'),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/reviewer', async (c) => {
    const body = setTaskReviewerInputSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        setTaskReviewer(tx, auth, c.req.param('taskId'), body.data),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId', async (c) => {
    const body = updateTaskSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBody(c, body.error);
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

  // The task's latest subject-linked automation run in any state — the
  // property panel's Run row, which outlives the live banner.
  app.get('/:taskId/latest-automation-run', async (c) => {
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
        run: await findLatestAutomationRunForTask(deps.sql, {
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
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await authCtx(c);
      const workflowSlug = body.data.workflowSlug;
      // READ COMMITTED, as the REST start door: the start's guard takes an
      // advisory lock and then reads the live runs, and only a fresh
      // statement snapshot sees a racing door's committed run. The task is
      // reloaded and judged inside the same transaction that starts the run.
      let started = null as Awaited<
        ReturnType<typeof startWorkflowForTaskInTx>
      >;
      await deps.sql.begin('isolation level read committed', async (tx) => {
        const task = await loadTaskOrThrow(
          tx,
          c.req.param('taskId'),
          auth.organizationId,
        );
        const project = await loadProjectOrThrow(tx, task.projectId);
        // Starting a run is a change to the task (it spends budget and
        // moves the card) — the manual agent-run kick's gate, not the
        // read-level banner's — and an archived task starts nothing.
        await assertTaskWorkable(tx, project, task, auth);
        assertTaskNotArchived(task);
        await assertAutomationForTask(tx, {
          project,
          auth,
          task,
          automation: workflowSlug,
        });
        started = await startWorkflowForTaskInTx(tx, {
          organizationId: auth.organizationId,
          task,
          workflowSlug,
          startedByUserId: auth.userId,
        });
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

  // Cancel the in-flight subject-linked run (if any) and move the task where
  // the body says: `cancelled` by default, so desk Start can re-trigger, or
  // the column a person dragged it to. Idempotent when idle.
  app.post('/:taskId/workflow/cancel', async (c) => {
    // No body is the default stop; the board's move names its column.
    const body = workflowStopSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    const { status, beforeTaskId, afterTaskId } = body.data;
    try {
      const auth = await authCtx(c);
      const task = await loadTaskOrThrow(
        deps.sql,
        c.req.param('taskId'),
        auth.organizationId,
      );
      const project = await loadProjectOrThrow(deps.sql, task.projectId);
      // The work gate must precede the run cancel: the move below asserts
      // it too, but by then the live run would already be dead — someone
      // who may not work the task is refused before any side effect.
      await assertTaskWorkable(deps.sql, project, task, auth);
      const live = await findLiveAutomationRunForTask(deps.sql, {
        organizationId: auth.organizationId,
        projectId: task.projectId,
        taskId: task.id,
      });
      // ONE transaction for the run cancel and the move: if the move
      // refuses (open subtasks under a closing move, archived), the cancel
      // rolls back with it — never a dead run behind a task that answered an
      // error. The move is the board's own (`moveTask`), straight to where
      // the person put the card: passing through Cancelled on the way to an
      // open column would meet the closure guard for a close nobody asked.
      const executionCancelled = await transactSerializable(
        deps.sql,
        async (tx) => {
          const cancelled =
            live === null
              ? false
              : (
                  await cancelRunInTx(
                    tx,
                    auth.organizationId,
                    live.runId,
                    auth.userId,
                  )
                ).cancelled;
          // A default stop on a task already where it lands writes nothing.
          // A drop names its place between two cards: that place still
          // applies when another session moved the task to the same column
          // while this one confirmed the stop.
          const placed =
            beforeTaskId !== undefined || afterTaskId !== undefined;
          if (task.status !== status || placed) {
            await moveTask(tx, auth, {
              taskId: task.id,
              status,
              ...(beforeTaskId !== undefined ? { beforeTaskId } : {}),
              ...(afterTaskId !== undefined ? { afterTaskId } : {}),
            });
          }
          return cancelled;
        },
      );
      return c.json({
        taskCancelled: status === 'cancelled',
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
      const live = await liveAgentRunOfTask(deps.sql, task.id);
      // Whoever may work the task stops its run — and so does the person
      // who started the run, once the task is no longer theirs (handing an
      // assigned task to an agent makes the agent its assignee).
      if (live === undefined || live.startedBy !== auth.userId) {
        await assertTaskWorkable(deps.sql, project, task, auth);
      } else {
        assertTaskReadable(project, auth);
      }
      const runId = live?.id;
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

  app.post('/:taskId/status', async (c) => {
    const body = z
      .object({ status: statusSchema })
      .safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await authCtx(c);
      const nextTask = await transactSerializable(deps.sql, (tx) =>
        updateTaskStatus(tx, auth, c.req.param('taskId'), body.data.status),
      );
      return c.json(statusMoved(nextTask));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/move', async (c) => {
    const body = moveSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await authCtx(c);
      const nextTask = await transactSerializable(deps.sql, (tx) =>
        moveTask(tx, auth, { taskId: c.req.param('taskId'), ...body.data }),
      );
      return c.json(statusMoved(nextTask));
    } catch (error) {
      return handleError(c, error);
    }
  });

  // "Stop repeating" — the next-task toast's action: the series ends here,
  // and a next task nobody has touched yet is taken back.
  app.post('/:taskId/repeat/stop', async (c) => {
    try {
      const auth = await authCtx(c);
      const { removedNextTask } = await transactSerializable(deps.sql, (tx) =>
        stopTaskRepeat(tx, auth, c.req.param('taskId')),
      );
      return c.json({ ok: true, removedNextTask });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:taskId/assign', async (c) => {
    const body = assignSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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
