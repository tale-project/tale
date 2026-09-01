/**
 * Native backend for the `task` platform connector — the task lifecycle as
 * automation capabilities: read a task, move its status, write and read its
 * discussion comments.
 *
 * The thin rim: input narrowing and the marker-window semantics. The store
 * fronts the task domain's own trusted writers, so actor attribution, the
 * "agents never complete work" invariant, and org scoping stay where they
 * live today.
 */

import { z } from 'zod';

import type {
  NativeConnectorContext,
  NativeConnectorImpl,
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
}

export interface WorkflowTaskComment {
  authorType: 'user' | 'agent';
  authorId: string;
  body: string;
  createdAt: number;
}

/** What the rim needs from the platform's task domain. */
export interface WorkflowTaskStore {
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
    bodyByLocale?: { en: string; de: string; fr: string };
  }): Promise<{ messageId: string }>;
  listComments(args: {
    organizationId: string;
    taskId: string;
  }): Promise<WorkflowTaskComment[]>;
}

const taskRef = z.object({ taskId: z.string().min(1) });

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

const commentInput = taskRef
  .extend({
    body: z.string().min(1),
    bodyByLocale: z
      .object({ en: z.string(), de: z.string(), fr: z.string() })
      .strict()
      .optional(),
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
    const all = await store.listComments({
      organizationId: ctx.organizationId,
      taskId: parsed.data.taskId,
    });
    const { afterMarker, authorTypes, limit } = parsed.data;
    let window = all;
    if (afterMarker !== undefined) {
      // The marker names a delivery anchor; only what people said AFTER the
      // last one counts as fresh feedback.
      const lastAnchor = all.reduce(
        (found, entry, index) =>
          entry.body.includes(afterMarker) ? index : found,
        -1,
      );
      window = all.slice(lastAnchor + 1);
    }
    if (authorTypes !== undefined) {
      const wanted = new Set<string>(authorTypes);
      window = window.filter((entry) => wanted.has(entry.authorType));
    }
    if (limit !== undefined) window = window.slice(-limit);
    return {
      count: window.length,
      comments: window.map((entry) => ({
        authorType: entry.authorType,
        authorId: entry.authorId,
        body: entry.body,
        createdAt: entry.createdAt,
      })),
    };
  };

  return {
    'task.get': get,
    'task.update_status': updateStatus,
    'task.comment': comment,
    'task.list_comments': listComments,
  };
}
