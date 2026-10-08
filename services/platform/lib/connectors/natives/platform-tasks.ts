/**
 * Native backend for the `task` platform connector — the task lifecycle as
 * automation capabilities: read a task, move its status, write and read its
 * discussion comments, put the task's project agent to work, and keep a
 * scheduled issue import's position between its occurrences.
 *
 * The thin rim: input narrowing and the marker-window semantics. The store
 * fronts the task domain's own trusted writers, so actor attribution, the
 * "agents never complete work" invariant, and org scoping stay where they
 * live today.
 */

import {
  taskExternalIssueSchema,
  type TaskExternalIssue,
} from '@tale/shared/schemas/task-external-issue';
import { z } from 'zod';

import { importedTaskTitleRefusal } from '../../../backend/core/tasks/helpers';
import {
  taskCommentBodiesSchema,
  type TaskCommentBodies,
} from '../../shared/schemas/task-comment';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
  ConnectorCaller,
} from '../dispatcher';
import { ConnectorError } from '../errors';

/**
 * The statuses an automation may MOVE a task to — every column except `done`.
 *
 * `done` is absent on purpose, and this list is the contract's honest half:
 * completion belongs to the human review gate (the catalog entry has said so
 * since the connector shipped), so offering it here would only let someone
 * author a node that is refused every time it runs. Cancelling is not
 * completing — abandoning a card is an automation's call to make — so it
 * stays.
 */
const AUTOMATION_TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'cancelled',
] as const;

export interface WorkflowTaskView {
  taskId: string;
  title: string;
  status: string;
  projectId: string;
  externalSystem?: string;
  externalId?: string;
  externalUrl?: string;
  /** The description as stored, each mention a mention link. */
  description?: string;
  /** The same text with each mention as `@` and the current name of whoever
   * it names. */
  descriptionText?: string;
}

export interface WorkflowTaskComment {
  authorType: 'user' | 'agent';
  authorId: string;
  /** The comment as stored, each mention a mention link. */
  body: string;
  /** The same text with each mention as `@` and the current name of whoever
   * it names. */
  bodyText: string;
  bodyByLocale?: Record<string, string>;
  createdAt: number;
}

export interface WorkflowIssueInput {
  externalSystem: string;
  externalId: string;
  title: string;
  description?: string;
  externalUrl?: string;
  externalIssue?: TaskExternalIssue;
}

/** One imported issue as the task domain settled it. `title` is the title
 * the task carries after the write — the imported one as cut to the board's
 * cap, or the stored one a source-snapshot reconcile leaves alone — never
 * merely the title that was sent. */
export interface WorkflowIssueResult {
  taskId: string | null;
  created: boolean;
  title: string;
}

/** What the rim needs from the platform's task domain. */
export interface WorkflowTaskStore {
  upsertIssues(args: {
    organizationId: string;
    caller: ConnectorCaller;
    projectId: string;
    issues: WorkflowIssueInput[];
  }): Promise<WorkflowIssueResult[]>;
  listExternalIssues(args: {
    organizationId: string;
    caller: ConnectorCaller;
    projectId: string;
    externalSystem: 'github' | 'glitchtip';
    repositoryId?: number;
    sourceOrigin?: string;
    sourceProjectId?: string;
    limit: number;
    legacyPrefixes?: string[];
  }): Promise<{
    issues: Array<{
      taskId: string;
      externalId: string;
      externalIssue: TaskExternalIssue | null;
    }>;
    hasMore: boolean;
  }>;
  upsert(args: {
    organizationId: string;
    caller: ConnectorCaller;
    projectId: string;
    externalSystem: string;
    externalId: string;
    title: string;
    description?: string;
    externalUrl?: string;
    externalIssue?: TaskExternalIssue;
  }): Promise<WorkflowIssueResult>;
  get(args: {
    organizationId: string;
    taskId: string;
  }): Promise<WorkflowTaskView | null>;
  updateStatus(args: {
    organizationId: string;
    taskId: string;
    status: (typeof AUTOMATION_TASK_STATUSES)[number];
  }): Promise<{ ok: boolean; reason?: string }>;
  comment(args: {
    organizationId: string;
    taskId: string;
    body: string;
    bodyByLocale?: TaskCommentBodies;
  }): Promise<{ messageId: string }>;
  /** The NEWEST comments the store will answer in one read, chronological;
   * `truncated` when the discussion holds older ones beyond that window. */
  listComments(args: {
    organizationId: string;
    taskId: string;
  }): Promise<{ comments: WorkflowTaskComment[]; truncated: boolean }>;
  /** Put the task's project agent (or the named one) to work, answering to
   * whoever the calling automation run answers to. */
  startAgent(args: {
    organizationId: string;
    caller: ConnectorCaller;
    taskId: string;
    agentId?: string;
    feedback?: string;
    moveToInProgress?: boolean;
  }): Promise<WorkflowAgentStart>;
  /** Where a scheduled import of the project's source resumes, counting the
   * read as an attempt. */
  getImportCursor(
    args: WorkflowImportCursorKey,
  ): Promise<WorkflowImportCursorRead>;
  /** Advance the source's position, compare-and-set on the revision the
   * batch's read answered. */
  saveImportCursor(
    args: WorkflowImportCursorKey & { revision: string; next: string },
  ): Promise<WorkflowImportCursorSave>;
}

/** Which listing an import position belongs to. */
interface WorkflowImportCursorKey {
  organizationId: string;
  caller: ConnectorCaller;
  projectId: string;
  externalSystem: 'github' | 'glitchtip';
  source: string;
}

/** What `task.get_import_cursor` answers. */
interface WorkflowImportCursorRead {
  /** Where this batch starts — `''` for the first batch of a pass. */
  cursor: string;
  /** The position's opaque compare token, handed back to the save. */
  revision: string;
  batch: number;
  resumed: boolean;
  /** The stored position failed repeatedly and this batch starts over. */
  restarted: boolean;
  passStartedAt: number | null;
  lastDrainedAt: number | null;
}

/** What `task.save_import_cursor` answers. */
interface WorkflowImportCursorSave {
  saved: boolean;
  drained: boolean;
  batch: number;
  conflict: boolean;
  revision: string;
}

/** What `task.start_agent` answers: the run it started (or found), or why
 * it started none without failing — the task's live run already carries the
 * work, an in-place start met a card waiting for a person's review or a
 * closed one, an open dependency blocks the task, or the task's circuit
 * breaker is open. An agent busy on other tasks is started all the same: its
 * run works in a worker of its own, or waits for one (`waitingReason`). */
export interface WorkflowAgentStart {
  started: boolean;
  /** The run started, or the one already working the task; null when none
   * applies. */
  runId: string | null;
  taskId: string;
  agentId: string;
  reason?: 'already_running' | 'in_review' | 'closed' | 'blocked' | 'paused';
  /** The step's first delivery started this run; this delivery found it. */
  replayed?: boolean;
  /** A started run that waits for a free agent worker instead of working
   * yet, and why: `org_limit` (every worker of the organization is in use)
   * or `destroy_pending` (its workspace is being deleted). It starts by
   * itself once one frees. */
  waitingReason?: 'org_limit' | 'host' | 'destroy_pending' | 'exec_limit';
  /** The closed card's status (`closed`): done or cancelled. */
  taskStatus?: string;
  blockedBy?: string[];
  /** When the circuit breaker admits the next start (epoch ms). */
  retryAfter?: number;
}

const taskRef = z.object({ taskId: z.string().min(1) });

const upsertInput = z
  .object({
    projectId: z.string().trim().min(1),
    externalSystem: z.string().trim().min(1).max(100),
    externalId: z.string().trim().min(1).max(2000),
    // A blank title is refused after the parse, with the empty-title
    // sentence every task door answers (`refuseBlankTitle`).
    title: z.string().trim().max(10000),
    description: z.string().max(100000).optional(),
    externalIssue: taskExternalIssueSchema.optional(),
    externalUrl: z
      .url({ protocol: /^https?$/ })
      .max(4000)
      .optional(),
  })
  .strict();

const upsertIssuesInput = z
  .object({
    projectId: z.string().trim().min(1),
    issues: z.array(upsertInput.omit({ projectId: true })).max(500),
  })
  .strict();

const listExternalInput = z
  .object({
    projectId: z.string().trim().min(1),
    externalSystem: z.enum(['github', 'glitchtip']),
    repositoryId: z.number().int().positive().safe().optional(),
    sourceOrigin: z.url({ protocol: /^https$/ }).optional(),
    sourceProjectId: z.string().min(1).max(2000).optional(),
    legacyPrefixes: z.array(z.string().min(1).max(4000)).max(2).optional(),
    limit: z.number().int().min(1).max(500).default(500),
  })
  .strict()
  .refine(
    (value) =>
      value.externalSystem === 'github'
        ? value.repositoryId !== undefined
        : value.sourceOrigin !== undefined &&
          value.sourceProjectId !== undefined,
    { message: 'Supply the immutable source repository or project identity.' },
  );

const updateStatusInput = taskRef
  .extend({ status: z.enum(AUTOMATION_TASK_STATUSES) })
  .strict();

/**
 * The task store answers a refusal CODE (the workspace-tool bridge branches on
 * it); an operator reading a failed run needs the sentence. Rendering happens
 * here, at the surface that shows people the message — the store stays
 * machine-readable, and an unknown code still says something true.
 */
function refusalSentence(reason: string | undefined): string {
  switch (reason) {
    case 'AGENTS_CANNOT_COMPLETE':
      return 'an automation cannot close a task — moving to done stays reserved for the human review gate, so park it at in_review instead';
    case 'TASK_HAS_OPEN_SUBTASKS':
      return 'the task still has open subtasks; close or cancel those first';
    case 'TASK_WRONG_ORGANIZATION':
      return 'that task belongs to another organization';
    default:
      return reason ?? 'the transition is not allowed';
  }
}

/** The longest message a start hands the agent — the comment ceiling. */
const START_FEEDBACK_MAX = 10_000;

const startAgentInput = taskRef
  .extend({
    agentId: z.string().min(1).max(200).optional(),
    feedback: z.string().max(START_FEEDBACK_MAX).optional(),
    moveToInProgress: z.boolean().optional(),
  })
  .strict();

const importCursorKeyInput = z
  .object({
    projectId: z.string().trim().min(1),
    externalSystem: z.enum(['github', 'glitchtip']),
    source: z.string().trim().min(1).max(200),
  })
  .strict();

const saveImportCursorInput = importCursorKeyInput
  .extend({
    revision: z.string().min(1).max(40),
    next: z.string().max(12000),
  })
  .strict();

const commentInput = taskRef
  .extend({
    body: z.string().min(1),
    bodyByLocale: taskCommentBodiesSchema.optional(),
  })
  .strict();

const listCommentsInput = taskRef
  .extend({
    authorTypes: z.array(z.enum(['user', 'agent'])).optional(),
    /** Only comments NEWER than the last comment containing this marker —
     * how a workflow reads "operator feedback since the last delivery". */
    afterMarker: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

function refuse(action: string, issues: z.ZodError): never {
  throw new ConnectorError(
    'INPUT_INVALID',
    `task.${action}: ${issues.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
      .join('; ')}`,
    {},
  );
}

/**
 * A blank title names nothing, and is refused with the empty-title sentence
 * the agent's upsert and the app's intake answer (`importedTaskTitleRefusal`)
 * — never the validator's "Too small: expected string to have >=1
 * characters". A batch names the item, by its index. Its length is never
 * refused: the task domain cuts an over-long one.
 */
function refuseBlankTitle(title: string, item?: number): void {
  const refusal = importedTaskTitleRefusal(title);
  if (refusal === null) return;
  throw new ConnectorError(
    'INPUT_INVALID',
    item === undefined ? refusal : `issues.${item}: ${refusal}`,
    {},
  );
}

function notFound(taskId: string): never {
  throw new ConnectorError(
    'INPUT_INVALID',
    `no task "${taskId}" exists in this organization`,
    {},
  );
}

export function platformTaskNatives(
  store: WorkflowTaskStore,
): Readonly<Record<string, NativeConnectorImpl>> {
  const upsert: NativeConnectorImpl = async (input, ctx) => {
    const parsed = upsertInput.safeParse(input);
    if (!parsed.success) refuse('upsert', parsed.error);
    refuseBlankTitle(parsed.data.title);
    if (
      parsed.data.externalIssue &&
      parsed.data.externalIssue.syncedAt > Date.now()
    ) {
      throw new ConnectorError(
        'INPUT_INVALID',
        'An issue observation cannot be dated in the future.',
        {},
      );
    }
    if (!ctx.caller) {
      throw new ConnectorError(
        'INPUT_INVALID',
        'task.upsert requires an authenticated caller',
        {},
      );
    }
    // The store answers the title the task now carries: the one sent was
    // trimmed here, but it is cut to the board's cap, or left unwritten by a
    // source-snapshot reconcile.
    return store.upsert({
      ...parsed.data,
      organizationId: ctx.organizationId,
      caller: ctx.caller,
    });
  };
  const upsertIssues: NativeConnectorImpl = async (input, ctx) => {
    const parsed = upsertIssuesInput.safeParse(input);
    if (!parsed.success) refuse('upsert_issues', parsed.error);
    for (const [index, issue] of parsed.data.issues.entries()) {
      refuseBlankTitle(issue.title, index);
    }
    if (!ctx.caller)
      throw new ConnectorError(
        'INPUT_INVALID',
        'task.upsert_issues requires an authenticated caller',
        {},
      );
    if (
      parsed.data.issues.some(
        (issue) =>
          issue.externalIssue && issue.externalIssue.syncedAt > Date.now(),
      )
    )
      throw new ConnectorError(
        'INPUT_INVALID',
        'An issue observation cannot be dated in the future.',
        {},
      );
    return store.upsertIssues({
      ...parsed.data,
      organizationId: ctx.organizationId,
      caller: ctx.caller,
    });
  };
  const listExternal: NativeConnectorImpl = async (input, ctx) => {
    const parsed = listExternalInput.safeParse(input);
    if (!parsed.success) refuse('list_external_issues', parsed.error);
    if (!ctx.caller)
      throw new ConnectorError(
        'INPUT_INVALID',
        'task.list_external_issues requires an authenticated caller',
        {},
      );
    return store.listExternalIssues({
      ...parsed.data,
      organizationId: ctx.organizationId,
      caller: ctx.caller,
    });
  };
  const get: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = taskRef.strict().safeParse(input);
    if (!parsed.success) refuse('get', parsed.error);
    const task = await store.get({
      organizationId: ctx.organizationId,
      taskId: parsed.data.taskId,
    });
    if (task === null) notFound(parsed.data.taskId);
    return task;
  };

  const updateStatus: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = updateStatusInput.safeParse(input);
    if (!parsed.success) refuse('update_status', parsed.error);
    const moved = await store.updateStatus({
      organizationId: ctx.organizationId,
      taskId: parsed.data.taskId,
      status: parsed.data.status,
    });
    if (!moved.ok) {
      throw new ConnectorError(
        'INPUT_INVALID',
        `task.update_status refused: ${refusalSentence(moved.reason)}`,
        {},
      );
    }
    return { ok: true, status: parsed.data.status };
  };

  const comment: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = commentInput.safeParse(input);
    if (!parsed.success) refuse('comment', parsed.error);
    const posted = await store.comment({
      organizationId: ctx.organizationId,
      taskId: parsed.data.taskId,
      body: parsed.data.body,
      ...(parsed.data.bodyByLocale !== undefined
        ? { bodyByLocale: parsed.data.bodyByLocale }
        : {}),
    });
    return { messageId: posted.messageId };
  };

  const listComments: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = listCommentsInput.safeParse(input);
    if (!parsed.success) refuse('list_comments', parsed.error);
    const listed = await store.listComments({
      organizationId: ctx.organizationId,
      taskId: parsed.data.taskId,
    });
    const all = listed.comments;
    const { afterMarker, authorTypes, limit } = parsed.data;
    let window = all;
    if (afterMarker !== undefined) {
      // The marker names a delivery anchor; only what people said AFTER the
      // last one counts as fresh feedback. Either form of the text counts: a
      // marker may name someone, and the stored form holds that as a link.
      const lastAnchor = all.reduce(
        (found, entry, index) =>
          entry.body.includes(afterMarker) ||
          entry.bodyText.includes(afterMarker)
            ? index
            : found,
        -1,
      );
      window = all.slice(lastAnchor + 1);
    }
    if (authorTypes !== undefined) {
      const wanted = new Set<string>(authorTypes);
      window = window.filter((entry) => wanted.has(entry.authorType));
    }
    if (limit !== undefined) window = window.slice(-limit);
    // `truncated` rides the payload so a workflow can tell "the whole
    // discussion" from "as much as one read answers" — a count alone reads
    // as complete either way, and a marker older than the window would
    // silently make everything look like fresh feedback.
    return {
      count: window.length,
      truncated: listed.truncated,
      comments: window.map((entry) => {
        const projected: WorkflowTaskComment = {
          authorType: entry.authorType,
          authorId: entry.authorId,
          body: entry.body,
          bodyText: entry.bodyText,
          createdAt: entry.createdAt,
        };
        if (entry.bodyByLocale !== undefined)
          projected.bodyByLocale = entry.bodyByLocale;
        return projected;
      }),
    };
  };

  const startAgent: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = startAgentInput.safeParse(input);
    if (!parsed.success) refuse('start_agent', parsed.error);
    if (ctx.caller?.kind !== 'workflow') {
      throw new ConnectorError(
        'INPUT_INVALID',
        'task.start_agent runs only as an automation step',
        {},
      );
    }
    return store.startAgent({
      organizationId: ctx.organizationId,
      caller: ctx.caller,
      taskId: parsed.data.taskId,
      ...(parsed.data.agentId !== undefined
        ? { agentId: parsed.data.agentId }
        : {}),
      ...(parsed.data.feedback !== undefined
        ? { feedback: parsed.data.feedback }
        : {}),
      ...(parsed.data.moveToInProgress !== undefined
        ? { moveToInProgress: parsed.data.moveToInProgress }
        : {}),
    });
  };

  const workflowCaller = (
    action: string,
    ctx: NativeConnectorContext,
  ): ConnectorCaller => {
    if (ctx.caller?.kind !== 'workflow') {
      throw new ConnectorError(
        'INPUT_INVALID',
        `task.${action} runs only as an automation step`,
        {},
      );
    }
    return ctx.caller;
  };
  const getImportCursor: NativeConnectorImpl = async (input, ctx) => {
    const parsed = importCursorKeyInput.safeParse(input);
    if (!parsed.success) refuse('get_import_cursor', parsed.error);
    return store.getImportCursor({
      ...parsed.data,
      organizationId: ctx.organizationId,
      caller: workflowCaller('get_import_cursor', ctx),
    });
  };
  const saveImportCursor: NativeConnectorImpl = async (input, ctx) => {
    const parsed = saveImportCursorInput.safeParse(input);
    if (!parsed.success) refuse('save_import_cursor', parsed.error);
    return store.saveImportCursor({
      ...parsed.data,
      organizationId: ctx.organizationId,
      caller: workflowCaller('save_import_cursor', ctx),
    });
  };

  return {
    'task.start_agent': startAgent,
    'task.get_import_cursor': getImportCursor,
    'task.save_import_cursor': saveImportCursor,
    'task.upsert': upsert,
    'task.upsert_issues': upsertIssues,
    'task.list_external_issues': listExternal,
    'task.get': get,
    'task.update_status': updateStatus,
    'task.comment': comment,
    'task.list_comments': listComments,
  };
}
