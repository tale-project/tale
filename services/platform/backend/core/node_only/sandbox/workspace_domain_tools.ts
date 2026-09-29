/**
 * First-party DOMAIN handlers of the workspace-tool bridge: the task family
 * and `document_create`. The dispatch (`workspace_tools_bridge.ts`) resolves
 * the session's authority ONCE (`resolveSessionActionContext`) and hands the
 * result here; these handlers own arg normalization and the org-scoped call
 * into the domain's OWN internal functions — the same posture as the
 * automation engine's `platform_stores.ts`: actor attribution, the task-ops
 * invariants ("agents never complete work", decomposition depth 1), and org
 * isolation stay exactly where they live today. Nothing here opens a second
 * route to org data.
 *
 * Write authorization = the grant: these tools reach a turn only when a user
 * explicitly equipped the agent with them (they are in no lane baseline), and
 * the async work lanes have no per-call approval card — so every handler
 * answers a structured refusal instead of throwing, and every write lands the
 * domain's full audit/event trail via the internal mutation it calls. The
 * grant is an editor's, so it reaches as far as the person who started the
 * run: a project agent's run a member started is confined to its own task
 * (`confinedToTaskId`) — its writes stay on that task and its subtasks, it
 * creates no labels, and it neither syncs external items nor saves project
 * documents.
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { extractExtension } from '../../../../lib/shared/file-types';
import { modelTimestamp } from '../../../../lib/shared/model-timestamp';
import {
  TASK_COMMENT_LOCALES_MAX,
  taskCommentBodiesSchema,
} from '../../../../lib/shared/schemas/task-comment';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import type { Doc, Id } from '../../lib/rows';
import {
  importedTaskTitleRefusal,
  TASK_COMMENT_MAX,
  taskCommentRefusal,
  taskLimitText,
  taskTitleRefusal,
} from '../../tasks/helpers';
import {
  isRecord,
  readBoolean,
  readLimit,
  readString,
  type ToolResult,
  type WorkspaceActionAuthority,
} from './workspace_tool_shared';

export const WORKSPACE_TASK_TOOLS = [
  'task_find',
  'task_get',
  'task_create',
  'task_comment',
  'task_update_status',
  'task_start_agent',
  'task_upsert_by_external_ref',
] as const;

export type WorkspaceTaskTool = (typeof WORKSPACE_TASK_TOOLS)[number];

export function isWorkspaceTaskTool(tool: string): tool is WorkspaceTaskTool {
  return (WORKSPACE_TASK_TOOLS as readonly string[]).includes(tool);
}

const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
/** Columns an agent may CREATE into — never the review/terminal columns. */
const TASK_CREATE_STATUSES = ['backlog', 'todo'] as const;
const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;

/** Labels one task tool call may name: the first ones are kept and the rest
 * dropped, before the domain's own per-name limit applies. */
export const TASK_LABELS_CAP = 20;
/** Inline document content cap — the bridge relays JSON over HTTP; anything
 * bigger belongs in the run's output harvest, not a tool arg. */
const DOCUMENT_CONTENT_MAX_CHARS = 600_000;
/** Content types `document_create` will store — safe text media only; never
 * `text/html`, which the raw storage route serves inline (stored XSS). */
const ALLOWED_DOCUMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

function pickTaskStatus(
  raw: unknown,
): (typeof TASK_STATUSES)[number] | undefined {
  return TASK_STATUSES.find((status) => status === raw);
}

function pickCreateStatus(
  raw: unknown,
): (typeof TASK_CREATE_STATUSES)[number] | undefined {
  return TASK_CREATE_STATUSES.find((status) => status === raw);
}

function pickPriority(
  raw: unknown,
): (typeof TASK_PRIORITIES)[number] | undefined {
  return TASK_PRIORITIES.find((priority) => priority === raw);
}

function readLabels(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const labels = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .slice(0, TASK_LABELS_CAP);
  return labels.length > 0 ? labels : undefined;
}

/** The longest message a failed call relays to the model — a guard, far
 * above any sentence the domain writes. */
const RELAYED_MESSAGE_MAX_CHARS = 400;

/**
 * Map a failed domain call to a structured result the model can act on. The
 * internal mutations refuse with coded `AppError`s (TASK_NOT_FOUND,
 * TASK_TITLE_INVALID, …) carrying the domain's own sentence beside the code.
 * An `invalid_args` relays both: the code is the refusal's identity, and the
 * sentence is what names the limit a value broke ("capped at 20,000 UTF-16
 * code units … this one has 20,431") — the code alone told the model that an
 * argument was wrong, never which rule it broke. Only the sentence travels:
 * the domain writes it for the caller, naming its limits and the lengths it
 * measured rather than the value it refused, and a structured payload beside
 * it is left behind. Anything else (a transient failure) reads as its
 * message, truncated — these carry validator prose, never secrets.
 */
function toolResultFromError(error: unknown): ToolResult {
  if (error instanceof AppError) {
    const data: unknown = error.data;
    const code =
      isRecord(data) && typeof data.code === 'string' ? data.code : 'REFUSED';
    if (code.endsWith('_NOT_FOUND')) {
      return {
        status: 'not_found',
        message: `${code}: no such record in this organization.`,
      };
    }
    const reason =
      isRecord(data) &&
      typeof data.message === 'string' &&
      data.message !== '' &&
      data.message !== code
        ? data.message.slice(0, RELAYED_MESSAGE_MAX_CHARS)
        : 'the domain refused these arguments.';
    return { status: 'invalid_args', message: `${code}: ${reason}` };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: 'error',
    message: message.slice(0, RELAYED_MESSAGE_MAX_CHARS),
  };
}

/** Name (+ optional key) for the task's project — kept beside `projectId` so
 * a list spanning several projects is readable without a follow-up fetch. */
type ProjectLabel = { name: string; key?: string };

/** The compact task shape the list/read tools answer with — identity, board
 * position, the external-sync key, and the schedule and repeat rule when the
 * row carries them; `description` only on `task_get`. */
function compactTask(
  task: Doc<'tasks'>,
  project?: ProjectLabel | null,
): Record<string, unknown> {
  return {
    taskId: String(task._id),
    number: task.number,
    title: task.title,
    status: task.status,
    projectId: String(task.projectId),
    ...(project != null
      ? {
          project: project.name,
          ...(project.key !== undefined ? { projectKey: project.key } : {}),
        }
      : {}),
    ...(task.priority !== undefined ? { priority: task.priority } : {}),
    ...(task.assigneeType !== undefined
      ? { assigneeType: task.assigneeType }
      : {}),
    ...(task.assigneeId !== undefined ? { assigneeId: task.assigneeId } : {}),
    ...(task.parentTaskId !== undefined
      ? { parentTaskId: String(task.parentTaskId) }
      : {}),
    ...(task.externalSystem !== undefined
      ? { externalSystem: task.externalSystem }
      : {}),
    ...(task.externalId !== undefined ? { externalId: task.externalId } : {}),
    ...(task.externalUrl !== undefined
      ? { externalUrl: task.externalUrl }
      : {}),
    commentCount: task.commentCount ?? 0,
    // ISO 8601 UTC, not epoch milliseconds: the agent reading this result gets
    // the same date format the chat tools answer with, and the same format its
    // own `Current time:` directive carries.
    createdAt: modelTimestamp(task.createdAt),
    updatedAt: modelTimestamp(task.updatedAt),
    // The schedule, in the same format: a task date is the midnight that
    // starts its day in the zone of whoever set it.
    ...(modelTimestamp(task.startDate) !== undefined
      ? { startDate: modelTimestamp(task.startDate) }
      : {}),
    ...(modelTimestamp(task.dueDate) !== undefined
      ? { dueDate: modelTimestamp(task.dueDate) }
      : {}),
    // The repeat rule as stored (days, step, zone, and `createOn:
    // "dueDate"` when the next task also comes on the due date): closing a
    // repeating task creates its next one.
    ...(isRecord(task.repeat) ? { repeat: task.repeat } : {}),
  };
}

async function projectLabelsById(
  ctx: ActionCtx,
  organizationId: string,
  projectIds: readonly string[],
): Promise<ReadonlyMap<string, ProjectLabel>> {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return new Map();
  const labels = await ctx.runQuery(
    internal.projects.internal_queries.getProjectLabelsForOrg,
    { organizationId, projectIds: unique },
  );
  return new Map(
    labels.map((row: { id: string; name: string; key?: string }) => [
      row.id,
      row.key !== undefined
        ? { name: row.name, key: row.key }
        : { name: row.name },
    ]),
  );
}

const asTaskId = (raw: string): Id<'tasks'> => raw;
const asProjectId = (raw: string): Id<'projects'> => raw;

/**
 * Resolve the project a task WRITE/list targets from the session's authority:
 *
 * - a PROJECT-bound run is pinned to its own project — a caller-supplied
 *   different id is refused, not silently rerouted;
 * - an org-wide run of a MULTI-BOUND automation may act only on the projects
 *   its automation is bound to: a requested id outside that set is refused, and
 *   a listing with no id named falls back to the whole bound set
 *   (`allowedProjectIds`), never the whole org;
 * - a truly org-level run (no bindings) names a project explicitly where one
 *   is required, and lists org-wide otherwise.
 */
function resolveTargetProject(
  authority: WorkspaceActionAuthority,
  callArgs: Record<string, unknown>,
):
  | { projectId?: string; allowedProjectIds?: string[] }
  | { refusal: ToolResult } {
  const requested = readString(callArgs.projectId);
  if (authority.scope.kind === 'project') {
    if (requested !== undefined && requested !== authority.scope.projectId) {
      return {
        refusal: {
          status: 'invalid_args',
          message:
            'This run is bound to one project; omit "projectId" — it is ' +
            "fixed to the run's own project.",
        },
      };
    }
    return { projectId: authority.scope.projectId };
  }
  const allowed = authority.scope.allowedProjectIds;
  if (requested !== undefined) {
    if (allowed !== undefined && !allowed.includes(requested)) {
      return {
        refusal: {
          status: 'invalid_args',
          message:
            'This run may act only on the projects its automation is bound ' +
            'to; that "projectId" is not one of them.',
        },
      };
    }
    return { projectId: requested };
  }
  return allowed !== undefined ? { allowedProjectIds: allowed } : {};
}

/** The one refusal a task the run may not reach returns. IDENTICAL for a task
 * that does not exist and a task that exists in another project — otherwise a
 * project-bound run could branch on the message to learn whether an opaque id
 * belongs to a sibling project (an existence oracle). */
const TASK_OUT_OF_SCOPE: ToolResult = {
  status: 'not_found',
  message: 'No task with that id is available to this run.',
};

/**
 * Guard an operation on an EXISTING task by the session's authority. A
 * project-bound run may only touch tasks in its own project — the create-time
 * `resolveTargetProject` pins new tasks, but reads and mutations take a raw
 * task id, so the boundary has to be re-checked against the loaded row (org
 * scoping alone would let a bound run reach another project's board). An
 * org-level run may touch any task in the org, which is its surface. Returns
 * the loaded task (a cheap org-scoped point read) so the caller reuses it, or
 * the single {@link TASK_OUT_OF_SCOPE} refusal — a denied task is
 * indistinguishable from a missing one.
 */
async function loadTaskInScope(
  ctx: ActionCtx,
  organizationId: string,
  taskId: string,
  authority: WorkspaceActionAuthority,
): Promise<{ task: Doc<'tasks'> } | { refusal: ToolResult }> {
  const task = await ctx.runQuery(
    internal.tasks.internal_queries.getTaskByIdInternal,
    { organizationId, taskId: asTaskId(taskId) },
  );
  if (task === null) {
    return { refusal: TASK_OUT_OF_SCOPE };
  }
  if (
    authority.scope.kind === 'project' &&
    String(task.projectId) !== authority.scope.projectId
  ) {
    return { refusal: TASK_OUT_OF_SCOPE };
  }
  // A multi-bound automation run org-wide may only reach tasks in its bound
  // projects — the same out-of-scope refusal, so a bound run cannot use the
  // message to probe for a sibling project's task id.
  if (
    authority.scope.kind === 'org' &&
    authority.scope.allowedProjectIds !== undefined &&
    !authority.scope.allowedProjectIds.includes(String(task.projectId))
  ) {
    return { refusal: TASK_OUT_OF_SCOPE };
  }
  return { task };
}

/** The one blocker a run a member started answers for a write beyond its
 * own task: the model is told what it may still do, and what an editor
 * would have to do instead. */
function memberRunRefusal(guidance: string): ToolResult {
  return {
    status: 'unavailable',
    blockers: [
      {
        code: 'member_run',
        guidance:
          'This run was started by a member who can work only their own ' +
          `task. ${guidance}`,
      },
    ],
  };
}

/** How many parents the confinement walk reads before it gives up — real
 * subtask trees are a level or two deep. */
const CONFINED_TREE_DEPTH_MAX = 16;

/**
 * Whether the task is the confined run's own task or hangs under it — a
 * bounded walk up the parent chain over the org-scoped point read.
 */
async function withinConfinedTask(
  ctx: ActionCtx,
  organizationId: string,
  task: Doc<'tasks'>,
  rootTaskId: string,
): Promise<boolean> {
  let current: Doc<'tasks'> | null = task;
  for (
    let depth = 0;
    current !== null && depth <= CONFINED_TREE_DEPTH_MAX;
    depth++
  ) {
    if (String(current._id) === rootTaskId) return true;
    if (current.parentTaskId === undefined) return false;
    current = await ctx.runQuery(
      internal.tasks.internal_queries.getTaskByIdInternal,
      { organizationId, taskId: current.parentTaskId },
    );
  }
  return false;
}

/** Why a start answered without starting — what the model is told to do. */
const START_AGENT_GUIDANCE: Record<string, string> = {
  already_running:
    'The task already has a live run carrying the work; nothing new started. ' +
    'Leave it to that run.',
  agent_busy:
    'That agent is working another task (busyTaskId) in its workspace; ' +
    'nothing started. Pick another agent or leave the task queued.',
  blocked:
    'Open tasks block this one (blockedBy); nothing started. Start it once ' +
    'they are done.',
  paused:
    'This task took three starts by automations and agents within the hour; ' +
    'its circuit breaker admits the next one at retryAfter. Report the task ' +
    'instead of restarting it.',
};

/** `task_start_agent`: a project agent's live run puts another agent of the
 * project to work (`domains/tasks/delegated-start.ts`). A confined run — one
 * a member started — never delegates; the rest is the domain's. */
async function runTaskStartAgent(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    callArgs: Record<string, unknown>;
    authority: WorkspaceActionAuthority;
    session?: { sessionId: string; taskRunExecId?: string };
  },
): Promise<ToolResult> {
  const { callArgs } = args;
  if (args.authority.confinedToTaskId !== undefined) {
    return memberRunRefusal(
      'It cannot put other agents to work. Say in your result which task ' +
        'should be started: an editor has to start that agent.',
    );
  }
  if (
    args.authority.scope.kind !== 'project' ||
    args.session?.taskRunExecId === undefined
  ) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'not_a_project_agent_run',
          guidance:
            'Only a project agent run can put another agent to work; an ' +
            'automation starts agents with a task.start_agent step.',
        },
      ],
    };
  }
  const taskId = readString(callArgs.taskId);
  const agentId =
    callArgs.agentId === undefined ? undefined : readString(callArgs.agentId);
  const feedback =
    typeof callArgs.feedback === 'string' && callArgs.feedback.trim() !== ''
      ? callArgs.feedback
      : undefined;
  const moveToInProgress =
    typeof callArgs.moveToInProgress === 'boolean'
      ? callArgs.moveToInProgress
      : undefined;
  if (
    taskId === undefined ||
    (callArgs.agentId !== undefined && agentId === undefined) ||
    (callArgs.feedback !== undefined &&
      typeof callArgs.feedback !== 'string') ||
    (callArgs.moveToInProgress !== undefined && moveToInProgress === undefined)
  ) {
    return {
      status: 'invalid_args',
      message:
        'task_start_agent needs {taskId: string, agentId?: string, ' +
        'feedback?: string, moveToInProgress?: boolean}.',
    };
  }
  if (feedback !== undefined) {
    const refusal = taskCommentRefusal(feedback);
    if (refusal !== null) {
      return { status: 'invalid_args', message: `feedback: ${refusal}` };
    }
  }
  const scoped = await loadTaskInScope(
    ctx,
    args.organizationId,
    taskId,
    args.authority,
  );
  if ('refusal' in scoped) return scoped.refusal;
  const answer = await ctx.runMutation(
    internal.tasks.internal_mutations.agentStartTaskAgent,
    {
      organizationId: args.organizationId,
      sessionId: args.session.sessionId,
      taskRunExecId: args.session.taskRunExecId,
      taskId,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(feedback !== undefined ? { feedback } : {}),
      ...(moveToInProgress !== undefined ? { moveToInProgress } : {}),
    },
  );
  if (!isRecord(answer) || typeof answer.outcome !== 'string') {
    return { status: 'error', message: 'The start answered nothing usable.' };
  }
  const { outcome, ...rest } = answer;
  if (outcome === 'started') {
    return { status: 'ok', output: { started: true, ...rest } };
  }
  return {
    status: 'ok',
    output: {
      started: false,
      reason: outcome,
      guidance: START_AGENT_GUIDANCE[outcome] ?? 'Nothing started.',
      ...rest,
    },
  };
}

export async function runTaskTool(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    tool: WorkspaceTaskTool;
    callArgs: Record<string, unknown>;
    authority: WorkspaceActionAuthority;
    /** The session and the task run its token names — what a delegation
     * proves its requesting run with (`task_start_agent`). */
    session?: { sessionId: string; taskRunExecId?: string };
  },
): Promise<ToolResult> {
  const { organizationId, callArgs, authority } = args;
  const actorId = authority.actorId;
  const confinedTo = authority.confinedToTaskId;
  const outsideOwnTask = (): ToolResult =>
    memberRunRefusal(
      `It may change only task ${confinedTo ?? ''} and the subtasks under ` +
        'it; leave other tasks as they are, and mention in your result ' +
        'anything that should change on them.',
    );

  try {
    if (args.tool === 'task_find') {
      const target = resolveTargetProject(authority, callArgs);
      if ('refusal' in target) return target.refusal;
      const status = pickTaskStatus(callArgs.status);
      if (callArgs.status !== undefined && status === undefined) {
        return {
          status: 'invalid_args',
          message: `"status" must be one of ${TASK_STATUSES.join(', ')}.`,
        };
      }
      const assigneeId = readString(callArgs.assigneeId);
      const limit = readLimit(callArgs.limit, 50);
      const rows = await ctx.runQuery(
        internal.tasks.internal_queries.listTasksForAgent,
        {
          organizationId,
          ...(target.projectId !== undefined
            ? { projectId: asProjectId(target.projectId) }
            : {}),
          // No single project named, but a bound org-wide run still lists only
          // across its bound projects — never the whole organization.
          ...(target.projectId === undefined &&
          target.allowedProjectIds !== undefined
            ? { projectIds: target.allowedProjectIds.map(asProjectId) }
            : {}),
          ...(status !== undefined ? { status } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(readBoolean(callArgs.includeArchived) === true
            ? { includeArchived: true }
            : {}),
        },
      );
      const sliced = rows.slice(0, limit);
      const projectsById = await projectLabelsById(
        ctx,
        organizationId,
        sliced.map((task: Doc<'tasks'>) => String(task.projectId)),
      );
      return {
        status: 'ok',
        output: {
          tasks: sliced.map((task: Doc<'tasks'>) =>
            compactTask(task, projectsById.get(String(task.projectId)) ?? null),
          ),
          totalFound: rows.length,
          ...(rows.length > limit
            ? { note: `Showing the first ${limit} of ${rows.length}.` }
            : {}),
        },
      };
    }

    if (args.tool === 'task_get') {
      const taskId = readString(callArgs.taskId);
      if (taskId === undefined) {
        return {
          status: 'invalid_args',
          message: 'task_get needs a "taskId" string.',
        };
      }
      // A project-bound run may only read tasks on its own board — check
      // before the full context read leaks another project's discussion.
      const scoped = await loadTaskInScope(
        ctx,
        organizationId,
        taskId,
        authority,
      );
      if ('refusal' in scoped) return scoped.refusal;
      const context = await ctx.runQuery(
        internal.tasks.internal_queries.getTaskContextForAgent,
        {
          organizationId,
          taskId: asTaskId(taskId),
          commentLimit: readLimit(callArgs.commentLimit, 50),
        },
      );
      if (context === null) {
        return {
          status: 'not_found',
          message: 'No task with that id in this organization.',
        };
      }
      return {
        status: 'ok',
        output: {
          task: {
            ...compactTask(context.task, context.project),
            ...(context.task.description !== undefined
              ? { description: context.task.description }
              : {}),
          },
          project: context.project,
          subtasks: context.subtasks,
          blockedBy: context.blockedBy,
          comments: context.comments,
        },
      };
    }

    if (args.tool === 'task_create') {
      if (typeof callArgs.title !== 'string') {
        return {
          status: 'invalid_args',
          message: 'task_create needs a non-empty "title" string.',
        };
      }
      // An empty (or whitespace-only) title and an over-long one are told
      // apart in the very sentence the domain's validateTitle refuses them
      // with, the range and its unit named. Refused at the boundary, nothing
      // is read or written for a call that cannot land, and the model is
      // told what to do about it.
      const titleRefusal = taskTitleRefusal(callArgs.title);
      if (titleRefusal !== null) {
        return {
          status: 'invalid_args',
          message:
            callArgs.title.trim() === ''
              ? `${titleRefusal} Name the task in a short title.`
              : `${titleRefusal} Shorten it and put the detail in ` +
                '"description".',
        };
      }
      const title = callArgs.title.trim();
      const target = resolveTargetProject(authority, callArgs);
      if ('refusal' in target) return target.refusal;
      if (target.projectId === undefined) {
        return {
          status: 'invalid_args',
          message:
            target.allowedProjectIds !== undefined
              ? 'This run spans several projects, so task_create needs a ' +
                `"projectId" — one of: ${target.allowedProjectIds.join(', ')}.`
              : 'This run is org-level, so task_create needs a "projectId" — ' +
                'task_find shows which projects existing tasks live in.',
        };
      }
      if (
        callArgs.status !== undefined &&
        pickCreateStatus(callArgs.status) === undefined
      ) {
        return {
          status: 'invalid_args',
          message: `New tasks start in ${TASK_CREATE_STATUSES.join(' or ')}.`,
        };
      }
      if (
        callArgs.priority !== undefined &&
        pickPriority(callArgs.priority) === undefined
      ) {
        return {
          status: 'invalid_args',
          message: `"priority" must be one of ${TASK_PRIORITIES.join(', ')}.`,
        };
      }
      const description = readString(callArgs.description);
      const parentTaskId = readString(callArgs.parentTaskId);
      if (confinedTo !== undefined && parentTaskId === undefined) {
        return memberRunRefusal(
          'task_create here only adds a subtask under the task this run ' +
            `works on: pass parentTaskId "${confinedTo}".`,
        );
      }
      if (parentTaskId !== undefined) {
        // Route the parent through the same scope gate so a foreign-project or
        // nonexistent parent both return the IDENTICAL refusal — the mutation
        // would otherwise distinguish them (TASK_PARENT_PROJECT_MISMATCH vs
        // TASK_NOT_FOUND → invalid_args vs not_found), an existence oracle.
        const parent = await loadTaskInScope(
          ctx,
          organizationId,
          parentTaskId,
          authority,
        );
        if ('refusal' in parent) return parent.refusal;
        if (
          confinedTo !== undefined &&
          !(await withinConfinedTask(
            ctx,
            organizationId,
            parent.task,
            confinedTo,
          ))
        ) {
          return outsideOwnTask();
        }
      }
      const created = await ctx.runMutation(
        internal.tasks.internal_mutations.agentCreateTask,
        {
          organizationId,
          actorId,
          projectId: asProjectId(target.projectId),
          title,
          ...(description !== undefined ? { description } : {}),
          ...(pickCreateStatus(callArgs.status) !== undefined
            ? { status: pickCreateStatus(callArgs.status) }
            : {}),
          ...(pickPriority(callArgs.priority) !== undefined
            ? { priority: pickPriority(callArgs.priority) }
            : {}),
          ...(readLabels(callArgs.labels) !== undefined
            ? { labels: readLabels(callArgs.labels) }
            : {}),
          ...(parentTaskId !== undefined
            ? { parentTaskId: asTaskId(parentTaskId) }
            : {}),
          // The label catalog is the project editors' to grow.
          ...(confinedTo !== undefined ? { mintLabels: false } : {}),
        },
      );
      return {
        status: 'ok',
        output: { taskId: String(created.taskId), created: true },
      };
    }

    if (args.tool === 'task_comment') {
      const taskId = readString(callArgs.taskId);
      if (taskId === undefined || typeof callArgs.body !== 'string') {
        return {
          status: 'invalid_args',
          message: 'task_comment needs {taskId, body}.',
        };
      }
      // An empty (or whitespace-only) body is told so in the domain's own
      // sentence, the range and its unit named, before any read. An
      // over-long one goes on to the domain, which refuses it under its code
      // with the same helper's sentence.
      const bodyRefusal = taskCommentRefusal(callArgs.body);
      if (bodyRefusal !== null && callArgs.body.trim() === '') {
        return { status: 'invalid_args', message: bodyRefusal };
      }
      const body = callArgs.body.trim();
      const localized = taskCommentBodiesSchema
        .optional()
        .safeParse(callArgs.bodyByLocale);
      if (!localized.success) {
        return {
          status: 'invalid_args',
          message:
            'task_comment bodyByLocale needs nonblank en/de/fr translations ' +
            `(at most ${taskLimitText(TASK_COMMENT_MAX)} each), with optional ` +
            'additional language or language-region keys (at most ' +
            `${TASK_COMMENT_LOCALES_MAX} locales in all).`,
        };
      }
      const scoped = await loadTaskInScope(
        ctx,
        organizationId,
        taskId,
        authority,
      );
      if ('refusal' in scoped) return scoped.refusal;
      if (
        confinedTo !== undefined &&
        !(await withinConfinedTask(
          ctx,
          organizationId,
          scoped.task,
          confinedTo,
        ))
      ) {
        return outsideOwnTask();
      }
      const posted = await ctx.runMutation(
        internal.tasks.internal_mutations.agentAddComment,
        {
          organizationId,
          actorId,
          taskId: asTaskId(taskId),
          body,
          ...(localized.data !== undefined
            ? { bodyByLocale: localized.data }
            : {}),
        },
      );
      return { status: 'ok', output: { messageId: posted.messageId } };
    }

    if (args.tool === 'task_update_status') {
      const taskId = readString(callArgs.taskId);
      const status = pickTaskStatus(callArgs.status);
      if (taskId === undefined || status === undefined) {
        return {
          status: 'invalid_args',
          message: `task_update_status needs {taskId, status: one of ${TASK_STATUSES.join(', ')}}.`,
        };
      }
      const scoped = await loadTaskInScope(
        ctx,
        organizationId,
        taskId,
        authority,
      );
      if ('refusal' in scoped) return scoped.refusal;
      if (
        confinedTo !== undefined &&
        !(await withinConfinedTask(
          ctx,
          organizationId,
          scoped.task,
          confinedTo,
        ))
      ) {
        return outsideOwnTask();
      }
      const moved = await ctx.runMutation(
        internal.tasks.internal_mutations.agentUpdateTaskStatus,
        { organizationId, actorId, taskId: asTaskId(taskId), status },
      );
      if (!moved.ok) {
        return {
          status: 'unavailable',
          blockers: [
            {
              code: moved.reason ?? 'refused',
              guidance:
                moved.reason === 'AGENTS_CANNOT_COMPLETE'
                  ? 'Agents never set done — move finished work to ' +
                    'in_review; a human review completes it.'
                  : moved.reason === 'TASK_HAS_OPEN_SUBTASKS'
                    ? 'Close or cancel the open subtasks first.'
                    : 'The status change was refused.',
            },
          ],
        };
      }
      return { status: 'ok', output: { taskId, status } };
    }

    if (args.tool === 'task_start_agent') {
      return await runTaskStartAgent(ctx, {
        organizationId,
        callArgs,
        authority,
        ...(args.session !== undefined ? { session: args.session } : {}),
      });
    }

    // task_upsert_by_external_ref — the idempotent external-item sync.
    if (confinedTo !== undefined) {
      return memberRunRefusal(
        'It cannot sync external items into the project. Say so in your ' +
          'result: an editor has to start the agent for that.',
      );
    }
    const externalSystem = readString(callArgs.externalSystem);
    const externalId = readString(callArgs.externalId);
    if (
      externalSystem === undefined ||
      externalId === undefined ||
      typeof callArgs.title !== 'string'
    ) {
      return {
        status: 'invalid_args',
        message:
          'task_upsert_by_external_ref needs {externalSystem, externalId, ' +
          'title} — the (externalSystem, externalId) pair is the idempotency ' +
          'key a re-run dedupes on.',
      };
    }
    // A blank title answers the empty-title sentence task_create answers.
    // Its length is never refused: the domain cuts an imported title, and
    // its description, to the cap.
    const titleRefusal = importedTaskTitleRefusal(callArgs.title);
    if (titleRefusal !== null) {
      return { status: 'invalid_args', message: titleRefusal };
    }
    const title = callArgs.title.trim();
    const createIfMissing = readBoolean(callArgs.createIfMissing) ?? true;
    const externalState =
      callArgs.externalState === 'open' || callArgs.externalState === 'closed'
        ? callArgs.externalState
        : undefined;
    const target = resolveTargetProject(authority, callArgs);
    if ('refusal' in target) return target.refusal;
    // A create-capable upsert needs a project to create in. A run confined to a
    // set of bound projects (a multi-bound automation run org-wide) needs one
    // even for an update-only reconcile: its dedupe is forced project-local
    // below, and that requires a single named project.
    if (
      target.projectId === undefined &&
      (createIfMissing || target.allowedProjectIds !== undefined)
    ) {
      return {
        status: 'invalid_args',
        message:
          target.allowedProjectIds !== undefined
            ? 'This run spans several projects, so ' +
              'task_upsert_by_external_ref needs a "projectId" — one of: ' +
              `${target.allowedProjectIds.join(', ')}.`
            : 'This run is org-level, so a create-capable upsert needs a ' +
              '"projectId" (or pass createIfMissing: false for an update-only ' +
              'reconcile).',
      };
    }
    // A run confined to project(s) MUST dedupe within a single project — the
    // org-wide dedupe would match (and then patch) a task on another project's
    // board. A project-bound run and a multi-bound run (now carrying a named,
    // in-set projectId) both force project-local dedupe; only a truly org-level
    // run keeps the caller's choice. So a bound run can never reach, update, or
    // close a foreign project's task through the external key.
    const dedupeScope: 'org' | 'project' | undefined =
      authority.scope.kind === 'project' ||
      (authority.scope.kind === 'org' &&
        authority.scope.allowedProjectIds !== undefined)
        ? 'project'
        : callArgs.dedupeScope === 'project' || callArgs.dedupeScope === 'org'
          ? callArgs.dedupeScope
          : undefined;
    const description = readString(callArgs.description);
    const externalUrl = readString(callArgs.externalUrl);
    const upserted = await ctx.runMutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId,
        actorId,
        externalSystem,
        externalId,
        title,
        createIfMissing,
        ...(target.projectId !== undefined
          ? { projectId: asProjectId(target.projectId) }
          : {}),
        ...(description !== undefined ? { description } : {}),
        ...(externalUrl !== undefined ? { externalUrl } : {}),
        ...(pickPriority(callArgs.priority) !== undefined
          ? { priority: pickPriority(callArgs.priority) }
          : {}),
        ...(readLabels(callArgs.labels) !== undefined
          ? { labels: readLabels(callArgs.labels) }
          : {}),
        ...(externalState !== undefined ? { externalState } : {}),
        ...(dedupeScope !== undefined ? { dedupeScope } : {}),
      },
    );
    return {
      status: 'ok',
      output: {
        taskId: upserted.taskId === null ? null : String(upserted.taskId),
        created: upserted.created,
      },
    };
  } catch (error) {
    return toolResultFromError(error);
  }
}

/**
 * `document_create`: save inline text content as a Documents-hub file. The
 * same name FROM THE SAME AUTHORITY refreshes that document instead of parking
 * a sibling (idempotent re-runs); the key is namespaced by the writing actor
 * so two agents on different projects that both write `report.md` get two
 * distinct documents instead of silently clobbering each other's blob. Folder
 * placement is the engine natives' job, not this tool's — it writes to the hub
 * root.
 */
export async function runDocumentCreate(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    callArgs: Record<string, unknown>;
    authority: WorkspaceActionAuthority;
  },
): Promise<ToolResult> {
  if (args.authority.confinedToTaskId !== undefined) {
    return memberRunRefusal(
      'It cannot save documents into the project. Write the file into this ' +
        "task's delivery box instead: files there are attached to the task " +
        'when the run ends.',
    );
  }
  const name = readString(args.callArgs.name);
  const content =
    typeof args.callArgs.content === 'string' ? args.callArgs.content : '';
  if (name === undefined || content === '') {
    return {
      status: 'invalid_args',
      message:
        'document_create needs {name (a file name, e.g. "report.md"), ' +
        'content (the full text)}.',
    };
  }
  if (name.length > 200) {
    return {
      status: 'invalid_args',
      message: 'The document name is capped at 200 characters.',
    };
  }
  if (content.length > DOCUMENT_CONTENT_MAX_CHARS) {
    return {
      status: 'invalid_args',
      message:
        `The inline content is capped at ${DOCUMENT_CONTENT_MAX_CHARS} ` +
        'characters — write larger artifacts to your output directory ' +
        'instead, where the run harvest picks them up.',
    };
  }
  // Whitelist the content type to a small set of safe text media. A caller
  // could otherwise store `text/html`, which the raw `/storage` route serves
  // INLINE from the deployment origin (a stored-XSS vector); anything not on
  // the list falls back to text/plain.
  const requestedType = readString(args.callArgs.contentType)?.toLowerCase();
  const contentType =
    requestedType !== undefined &&
    ALLOWED_DOCUMENT_CONTENT_TYPES.has(requestedType)
      ? requestedType
      : 'text/plain';
  const extension = extractExtension(name);

  // Where the document lands. A project-bound run files it INSIDE its project,
  // so it is a project file — not an org-wide hub document that every other
  // project's agents would see through baseline rag_search (`includeHub`). A
  // caller-named project is validated against the automation's bindings, the
  // same boundary the task tools apply; only a TRULY org-level run (no
  // bindings) writes the hub.
  const target = resolveTargetProject(args.authority, args.callArgs);
  if ('refusal' in target) return target.refusal;
  if (
    target.projectId === undefined &&
    target.allowedProjectIds !== undefined
  ) {
    // A run confined to several bound projects must NAME one: the hub is
    // org-wide — wider than the run's authority — and `task_create` refuses
    // the same case rather than picking a board for the agent.
    return {
      status: 'invalid_args',
      message:
        'This run spans several projects, so document_create needs a ' +
        `"projectId" — one of: ${target.allowedProjectIds.join(', ')}.`,
    };
  }
  const scopePrefix =
    target.projectId !== undefined
      ? `agent:project:${target.projectId}`
      : 'agent:hub';

  try {
    // Inline text: store the bytes first — sandbox staging skips
    // content-only rows, so a document must always carry a blob.
    const stored = await ctx.runAction(
      internal.documents.internal_actions.storeRawContent,
      {
        organizationId: args.organizationId,
        fileName: name,
        content,
        contentType,
        extension: extension ?? '',
      },
    );
    const upserted = await ctx.runMutation(
      internal.documents.internal_mutations.upsertDocumentByExternalId,
      {
        organizationId: args.organizationId,
        // Namespaced by the target scope AND the writing authority so a re-run
        // by the same agent in the same project is idempotent, while two
        // agents' (or two projects') same-named files never collide.
        externalItemId: `${scopePrefix}:${args.authority.actorId}:${name}`,
        title: name,
        fileId: String(stored.fileStorageId),
        mimeType: contentType,
        ...(extension !== undefined ? { extension } : {}),
        sourceProvider: 'agent',
        createdBy: args.authority.actorId,
        ...(target.projectId !== undefined && {
          projectId: asProjectId(target.projectId),
        }),
        // Leave a governance trail for this standing-grant write, as the task
        // tools do — attributed to the binding actor, not the deployer.
        auditActorId: args.authority.actorId,
      },
    );
    // Promote the blob to the document exactly as a human upload does: link the
    // fileMetadata row to the document (so the temp-agent-file GC does not reap
    // it) and schedule RAG indexing for the fresh row. Best-effort — a link
    // failure leaves the document created, logged rather than thrown.
    await ctx
      .runMutation(
        internal.file_metadata.internal_mutations.linkDocumentToFile,
        { storageId: stored.fileStorageId, documentId: upserted.documentId },
      )
      .catch((error: unknown) =>
        console.warn(
          '[workspace-tools] document_create link/index failed:',
          error,
        ),
      );
    return {
      status: 'ok',
      output: {
        documentId: String(upserted.documentId),
        action: upserted.action,
      },
    };
  } catch (error) {
    return toolResultFromError(error);
  }
}
