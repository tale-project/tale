/**
 * The task reads a manager agent walks a whole queue with (#3955): `task_find`
 * pages through every matching task with an opaque cursor bound to its
 * listing, and `task_get` answers ids for everything it lists, pages the
 * discussion and the run history, and tells running, finished and
 * person-bound work apart. A cursor the listing did not answer, and a read
 * that failed, are answered as such — never as a first page or an idle task.
 *
 * The board here is in memory: the keyset the domain runs in SQL (whose
 * order Postgres proves in `domains/tasks/agent-read-tools.integration.ts`)
 * is replayed over it, so these tests lock what the door does with a page —
 * its size, its end, its cursor — not the database's order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import { mintCursorFor } from '../../lib/signed_cursor';
import { taskFindListing } from './workspace_domain_tools';
import { dispatchWorkspaceToolImpl } from './workspace_tools_bridge';

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

interface BoardTask {
  _id: string;
  number: number;
  title: string;
  status: string;
  rank: string;
  projectId: string;
  commentCount: number;
  createdAt: number;
  updatedAt: number;
}

type Scope =
  | { kind: 'project'; projectId: string }
  | { kind: 'org'; allowedProjectIds?: string[] };

/** `n` tasks of one column, tied on status, rank and creation millisecond —
 * only their ids tell them apart. */
function tiedBoard(n: number, projectId = 'p-1'): BoardTask[] {
  return Array.from({ length: n }, (_, index) => ({
    _id: `t-${String(index).padStart(4, '0')}`,
    number: index + 1,
    title: `Task ${index + 1}`,
    status: 'backlog',
    rank: '0|hzzzzz:',
    projectId,
    commentCount: 0,
    createdAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
  }));
}

const compare = (a: readonly (string | number)[], b: typeof a): number => {
  for (let index = 0; index < a.length; index++) {
    const left = a[index] ?? '';
    const right = b[index] ?? '';
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
};

/** The domain's keyset, replayed in memory: rows strictly after `after` in
 * `order`, filtered like the SQL filters them. */
function keysetPage(
  board: readonly BoardTask[],
  args: Record<string, unknown>,
) {
  const key = (task: BoardTask) =>
    args.order === 'created'
      ? [task.createdAt, task._id]
      : [task.status, task.rank, task._id];
  const after = args.after as Record<string, unknown> | undefined;
  const afterKey =
    after === undefined
      ? undefined
      : after.order === 'created'
        ? [after.createdAt as number, after.id as string]
        : [after.status as string, after.rank as string, after.id as string];
  const projectIds =
    typeof args.projectId === 'string'
      ? [args.projectId]
      : (args.projectIds as string[] | undefined);
  return board
    .filter(
      (task) =>
        (projectIds === undefined || projectIds.includes(task.projectId)) &&
        (args.status === undefined || task.status === args.status),
    )
    .sort((a, b) => compare(key(a), key(b)))
    .filter(
      (task) => afterKey === undefined || compare(key(task), afterKey) > 0,
    )
    .slice(0, args.limit as number);
}

interface Harness {
  board: BoardTask[];
  scope: Scope;
  context: (args: Record<string, unknown>) => unknown;
  workState: (args: Record<string, unknown>) => unknown;
}

function createHarness(overrides: Partial<Harness> = {}) {
  const harness: Harness = {
    board: tiedBoard(3),
    scope: { kind: 'project', projectId: 'p-1' },
    context: () => ({
      task: {
        _id: 't-0000',
        title: 'Task 1',
        status: 'todo',
        projectId: 'p-1',
      },
      project: { name: 'Fleet' },
      subtasks: [],
      blockedBy: [],
      comments: [],
      commentsHasMore: false,
    }),
    workState: () => ({
      agentRuns: [],
      agentRunsHasMore: false,
      workflowRun: null,
      pendingReview: null,
    }),
    ...overrides,
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const runQuery = vi.fn(
    async (ref: unknown, args: Record<string, unknown>): Promise<unknown> => {
      const name = functionRefName(ref);
      calls.push({ name, args });
      if (name === 'sandbox/workspace_access:resolveSessionActionContext') {
        return { allowed: true, actorId: 'agent-1', scope: harness.scope };
      }
      if (name === 'tasks/internal_queries:listTasksForAgent') {
        return keysetPage(harness.board, args);
      }
      if (name === 'projects/internal_queries:getProjectLabelsForOrg') {
        return [];
      }
      if (name === 'tasks/internal_queries:getTaskByIdInternal') {
        const id = String(args.taskId);
        if (id === 't-foreign') return { _id: id, projectId: 'p-other' };
        return id.startsWith('t-') ? { _id: id, projectId: 'p-1' } : null;
      }
      if (name === 'tasks/internal_queries:getTaskContextForAgent') {
        return harness.context(args);
      }
      if (name === 'tasks/internal_queries:getTaskWorkStateForAgent') {
        return harness.workState(args);
      }
      return null;
    },
  );
  const ctx = {
    runQuery,
    runMutation: vi.fn(() => Promise.resolve(null)),
    runAction: vi.fn(),
  };
  const call = (tool: string, callArgs: Record<string, unknown>) =>
    dispatchWorkspaceToolImpl(ctx as never, {
      organizationId: 'org-1',
      sessionId: 'pa-agent-1',
      taskRunExecId: 'exec-1',
      tool,
      callArgs,
    }) as Promise<Record<string, unknown>>;
  const called = (name: string) =>
    calls.filter((entry) => entry.name === `tasks/internal_queries:${name}`);
  return { harness, call, called, calls };
}

const outputOf = (result: Record<string, unknown>) =>
  result.output as Record<string, unknown>;
const tasksOf = (result: Record<string, unknown>) =>
  (outputOf(result).tasks as { taskId: string }[]).map((task) => task.taskId);

/** Walk a listing to its end, as a manager would. */
async function walk(
  call: ReturnType<typeof createHarness>['call'],
  args: Record<string, unknown>,
) {
  const pages: Record<string, unknown>[] = [];
  let cursor: unknown;
  for (let guard = 0; guard < 50; guard++) {
    const result = await call('task_find', {
      ...args,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    expect(result.status).toBe('ok');
    pages.push(outputOf(result));
    if (outputOf(result).isDone === true) break;
    cursor = outputOf(result).continueCursor;
  }
  return pages;
}

describe('task_find pages a whole queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['board', 'created'] as const)(
    'walks 251 tasks tied on status, rank and creation time exactly once (%s order)',
    async (order) => {
      const { harness, call, called } = createHarness({
        board: tiedBoard(251),
      });
      const pages = await walk(call, { status: 'backlog', order, limit: 50 });
      expect(pages.map((page) => (page.tasks as unknown[]).length)).toEqual([
        50, 50, 50, 50, 50, 1,
      ]);
      const seen = pages.flatMap((page) =>
        (page.tasks as { taskId: string }[]).map((task) => task.taskId),
      );
      expect(new Set(seen).size).toBe(251);
      expect(seen).toEqual(harness.board.map((task) => task._id));
      // Every page but the last says more follows, and hands the cursor on;
      // the last says it is the end and hands none back.
      for (const page of pages.slice(0, -1)) {
        expect(page.isDone).toBe(false);
        expect(typeof page.continueCursor).toBe('string');
        expect(page).not.toHaveProperty('totalFound');
      }
      const last = pages.at(-1);
      expect(last?.isDone).toBe(true);
      expect(last).not.toHaveProperty('continueCursor');
      // A later page's count is that page's, never the listing's total.
      expect(last).not.toHaveProperty('totalFound');
      // One row past each page, and the order the walk asked for.
      expect(
        called('listTasksForAgent').map((entry) => entry.args.limit),
      ).toEqual([51, 51, 51, 51, 51, 51]);
      for (const entry of called('listTasksForAgent')) {
        expect(entry.args.order).toBe(order);
      }
    },
  );

  it('resumes after the row the previous page ended on, inside a tie', async () => {
    const { call, called } = createHarness({ board: tiedBoard(5) });
    const first = await call('task_find', { limit: 2 });
    await call('task_find', {
      limit: 2,
      cursor: outputOf(first).continueCursor,
    });
    expect(called('listTasksForAgent')[1]?.args.after).toEqual({
      order: 'board',
      status: 'backlog',
      rank: '0|hzzzzz:',
      id: 't-0001',
    });
    const created = await call('task_find', { order: 'created', limit: 2 });
    await call('task_find', {
      order: 'created',
      limit: 2,
      cursor: outputOf(created).continueCursor,
    });
    expect(called('listTasksForAgent')[3]?.args.after).toEqual({
      order: 'created',
      createdAt: 1_790_000_000_000,
      id: 't-0001',
    });
  });

  it('names a total only when one page holds every matching task', async () => {
    const { call } = createHarness({ board: tiedBoard(3) });
    const result = await call('task_find', {});
    expect(outputOf(result)).toMatchObject({ isDone: true, totalFound: 3 });
    expect(outputOf(result)).not.toHaveProperty('continueCursor');
    expect(outputOf(result)).not.toHaveProperty('note');
    const paged = await call('task_find', { limit: 2 });
    expect(outputOf(paged)).not.toHaveProperty('totalFound');
    expect(String(outputOf(paged).note)).toContain('continueCursor');
  });

  it('reads the first page for no cursor, null or an empty one', async () => {
    const { call, called } = createHarness({ board: tiedBoard(3) });
    for (const cursor of [undefined, null, '']) {
      const result = await call(
        'task_find',
        cursor !== undefined ? { cursor } : {},
      );
      expect(tasksOf(result)).toEqual(['t-0000', 't-0001', 't-0002']);
    }
    for (const entry of called('listTasksForAgent')) {
      expect(entry.args).not.toHaveProperty('after');
    }
  });

  it('continues only the listing that answered the cursor', async () => {
    const { call, called } = createHarness({ board: tiedBoard(5) });
    const first = await call('task_find', { status: 'backlog', limit: 2 });
    const cursor = outputOf(first).continueCursor;
    const reads = called('listTasksForAgent').length;
    for (const changed of [
      { status: 'todo' },
      {},
      { status: 'backlog', order: 'created' },
      { status: 'backlog', includeArchived: true },
      { status: 'backlog', assigneeId: 'agent-2' },
    ]) {
      const result = await call('task_find', { ...changed, limit: 2, cursor });
      expect(result.status).toBe('invalid_args');
      expect(String(result.message)).toContain('"cursor"');
    }
    // The page size may change between pages.
    const resized = await call('task_find', {
      status: 'backlog',
      limit: 3,
      cursor,
    });
    expect(tasksOf(resized)).toEqual(['t-0002', 't-0003', 't-0004']);
    // A refused cursor read nothing.
    expect(called('listTasksForAgent')).toHaveLength(reads + 1);
  });

  it('refuses a cursor from another scope — another project, another bound set, the organization', async () => {
    const { harness, call } = createHarness({ board: tiedBoard(5) });
    const first = await call('task_find', { limit: 2 });
    const cursor = outputOf(first).continueCursor;
    for (const scope of [
      { kind: 'project', projectId: 'p-2' },
      { kind: 'org' },
      { kind: 'org', allowedProjectIds: ['p-1', 'p-2'] },
    ] as Scope[]) {
      harness.scope = scope;
      const result = await call('task_find', { limit: 2, cursor });
      expect(result.status).toBe('invalid_args');
    }
    // A bound set is one scope whatever order the resolver lists it in.
    harness.scope = { kind: 'org', allowedProjectIds: ['p-2', 'p-1'] };
    const bound = await call('task_find', { limit: 2 });
    harness.scope = { kind: 'org', allowedProjectIds: ['p-1', 'p-2'] };
    const reordered = await call('task_find', {
      limit: 2,
      cursor: outputOf(bound).continueCursor,
    });
    expect(reordered.status).toBe('ok');
    harness.scope = { kind: 'org', allowedProjectIds: ['p-1', 'p-3'] };
    const rebound = await call('task_find', {
      limit: 2,
      cursor: outputOf(bound).continueCursor,
    });
    expect(rebound.status).toBe('invalid_args');
  });

  it('refuses a malformed, edited or foreign cursor instead of restarting at page one', async () => {
    const { call, called } = createHarness({ board: tiedBoard(5) });
    const first = await call('task_find', { limit: 2 });
    const cursor = String(outputOf(first).continueCursor);
    const dot = cursor.lastIndexOf('.');
    const position = cursor.slice(0, dot);
    const tag = cursor.slice(dot + 1);
    const flipped = `${position.slice(0, -1)}${position.endsWith('A') ? 'B' : 'A'}`;
    const boardListing = taskFindListing({
      order: 'board',
      target: { projectId: 'p-1' },
      includeArchived: false,
    });
    // The listing's own name signs the cursor it answered.
    expect(mintCursorFor('org-1', boardListing, position)).toBe(cursor);
    const reads = called('listTasksForAgent').length;
    for (const bad of [
      'not-a-cursor',
      cursor.slice(0, -1),
      `${flipped}.${tag}`,
      position,
      '   ',
      42,
      { cursor },
      // Another organization's cursor for the same listing, a REST list's
      // cursor, and one of task_get's lists: signed, but not by this one.
      mintCursorFor('org-2', boardListing, position),
      mintCursorFor('org-1', 'task-comments:t-0000', '12'),
      mintCursorFor('org-1', 'agent:task_get:comments:t-0000', '12'),
    ]) {
      const result = await call('task_find', { limit: 2, cursor: bad });
      expect(result).toEqual({
        status: 'invalid_args',
        message: expect.stringContaining('"cursor" is not a cursor'),
      });
    }
    expect(called('listTasksForAgent')).toHaveLength(reads);
  });

  it('refuses a position of another order even when this listing signed it', async () => {
    const { call, called } = createHarness({ board: tiedBoard(5) });
    const first = await call('task_find', { limit: 2 });
    const cursor = String(outputOf(first).continueCursor);
    const created = Buffer.from(
      JSON.stringify(['created', 1_790_000_000_000, 't-0001']),
    ).toString('base64url');
    // Re-sign the other order's position under the board listing's name.
    const forged = mintCursorFor(
      'org-1',
      taskFindListing({
        order: 'board',
        target: { projectId: 'p-1' },
        includeArchived: false,
      }),
      created,
    );
    expect(forged).not.toBe(cursor);
    const reads = called('listTasksForAgent').length;
    const result = await call('task_find', { limit: 2, cursor: forged });
    expect(result.status).toBe('invalid_args');
    expect(called('listTasksForAgent')).toHaveLength(reads);
  });

  it('refuses an order it does not walk', async () => {
    const { call } = createHarness();
    const result = await call('task_find', { order: 'priority' });
    expect(result).toEqual({
      status: 'invalid_args',
      message: '"order" must be one of board, created.',
    });
  });

  it('answers a failed read as an error, never as an empty queue', async () => {
    const { harness, call } = createHarness();
    harness.board = null as unknown as BoardTask[];
    const result = await call('task_find', {});
    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('output');
  });
});

describe('task_get reads what a manager decides with', () => {
  beforeEach(() => vi.clearAllMocks());

  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-2',
    seq: 12,
    agentId: 'agent-impl',
    status: 'settled',
    trigger: 'manual',
    startedAt: 1_790_000_000_000,
    launchedAt: 1_790_000_001_000,
    settledAt: 1_790_000_600_000,
    waitingForCapacity: false,
    failureCode: null,
    feedback: null,
    feedbackTruncated: false,
    ...overrides,
  });

  it('answers ids for subtasks, blockers and comments, and ISO dates', async () => {
    const { call } = createHarness({
      context: () => ({
        task: { _id: 't-0000', title: 'Ship it', status: 'in_review' },
        project: { name: 'Fleet', key: 'FL' },
        subtasks: [
          { taskId: 't-0001', number: 2, title: 'Sub', status: 'todo' },
        ],
        blockedBy: [
          { taskId: 't-0002', number: 3, title: 'Blocker', status: 'done' },
        ],
        comments: [
          {
            commentId: 'm-1',
            authorType: 'agent',
            authorId: 'agent-impl',
            body: 'Question for the manager (key q-1): which queue?',
            createdAt: 1_790_000_500_000,
            editedAt: 1_790_000_550_000,
          },
        ],
        commentsHasMore: false,
      }),
    });
    const result = await call('task_get', { taskId: 't-0000' });
    expect(result.status).toBe('ok');
    const output = outputOf(result);
    expect(output.subtasks).toEqual([
      { taskId: 't-0001', number: 2, title: 'Sub', status: 'todo' },
    ]);
    expect(output.blockedBy).toEqual([
      { taskId: 't-0002', number: 3, title: 'Blocker', status: 'done' },
    ]);
    expect(output.comments).toEqual([
      {
        commentId: 'm-1',
        authorType: 'agent',
        authorId: 'agent-impl',
        body: 'Question for the manager (key q-1): which queue?',
        createdAt: '2026-09-21T14:21:40.000Z',
        editedAt: '2026-09-21T14:22:30.000Z',
      },
    ]);
    expect(output.commentsPage).toEqual({ isDone: true });
    expect(output.agentRunsPage).toEqual({ isDone: true });
    expect(output.workflowRun).toBeNull();
    expect(output.pendingReview).toBeNull();
  });

  it('pages the discussion past its newest window, bound to the task', async () => {
    const { harness, call, called } = createHarness();
    harness.context = (args) => ({
      task: { _id: args.taskId, title: 'Busy', status: 'todo' },
      project: null,
      subtasks: [],
      blockedBy: [],
      comments: [],
      commentsHasMore: args.commentsBefore === undefined,
      ...(args.commentsBefore === undefined ? { commentsNextBefore: 41 } : {}),
    });
    const newest = await call('task_get', {
      taskId: 't-0000',
      commentLimit: 50,
    });
    const page = outputOf(newest).commentsPage as Record<string, unknown>;
    expect(page.isDone).toBe(false);
    const older = await call('task_get', {
      taskId: 't-0000',
      commentLimit: 50,
      commentCursor: page.continueCursor,
    });
    expect(outputOf(older).commentsPage).toEqual({ isDone: true });
    expect(
      called('getTaskContextForAgent').map(
        (entry) => entry.args.commentsBefore,
      ),
    ).toEqual([undefined, 41]);
    expect(called('getTaskContextForAgent')[0]?.args.commentLimit).toBe(50);
    // Another task's cursor, the run list's, and garbage are refused before
    // the task's context is read.
    const reads = called('getTaskContextForAgent').length;
    for (const [taskId, commentCursor] of [
      ['t-0001', page.continueCursor],
      [
        't-0000',
        mintCursorFor('org-1', 'agent:task_get:agent_runs:t-0000', '41'),
      ],
      ['t-0000', 'garbage'],
      ['t-0000', 41],
    ] as const) {
      const result = await call('task_get', { taskId, commentCursor });
      expect(result).toEqual({
        status: 'invalid_args',
        message: expect.stringContaining('"commentCursor" is not a cursor'),
      });
    }
    expect(called('getTaskContextForAgent')).toHaveLength(reads);
  });

  it('pages the run history newest first with runCursor', async () => {
    const { harness, call, called } = createHarness();
    harness.workState = (args) =>
      args.runsBeforeSeq === undefined
        ? {
            agentRuns: [
              run({ id: 'run-3', seq: 13 }),
              run({ id: 'run-2', seq: 12 }),
            ],
            agentRunsHasMore: true,
            workflowRun: null,
            pendingReview: null,
          }
        : {
            agentRuns: [run({ id: 'run-1', seq: 11 })],
            agentRunsHasMore: false,
            workflowRun: null,
            pendingReview: null,
          };
    const newest = await call('task_get', { taskId: 't-0000', runLimit: 2 });
    const runs = outputOf(newest).agentRuns as { runId: string }[];
    expect(runs.map((entry) => entry.runId)).toEqual(['run-3', 'run-2']);
    const page = outputOf(newest).agentRunsPage as Record<string, unknown>;
    expect(page.isDone).toBe(false);
    const older = await call('task_get', {
      taskId: 't-0000',
      runLimit: 2,
      runCursor: page.continueCursor,
    });
    expect(
      (outputOf(older).agentRuns as { runId: string }[]).map(
        (entry) => entry.runId,
      ),
    ).toEqual(['run-1']);
    expect(outputOf(older).agentRunsPage).toEqual({ isDone: true });
    expect(
      called('getTaskWorkStateForAgent').map(
        (entry) => entry.args.runsBeforeSeq,
      ),
    ).toEqual([undefined, 12]);
    const refused = await call('task_get', {
      taskId: 't-0000',
      runCursor: mintCursorFor('org-1', 'agent:task_get:comments:t-0000', '12'),
    });
    expect(refused.status).toBe('invalid_args');
  });

  it('clamps runLimit and defaults it to five', async () => {
    const { call, called } = createHarness();
    await call('task_get', { taskId: 't-0000' });
    await call('task_get', { taskId: 't-0000', runLimit: 500 });
    await call('task_get', { taskId: 't-0000', runLimit: -3 });
    expect(
      called('getTaskWorkStateForAgent').map((entry) => entry.args.runLimit),
    ).toEqual([5, 20, 5]);
    // The run state is read for the task's own project.
    expect(called('getTaskWorkStateForAgent')[0]?.args.projectId).toBe('p-1');
  });

  it('tells running, finished and person-bound work apart', async () => {
    const { harness, call } = createHarness();
    const read = async (state: Record<string, unknown>) => {
      harness.workState = () => ({
        agentRuns: [],
        agentRunsHasMore: false,
        workflowRun: null,
        pendingReview: null,
        ...state,
      });
      const result = await call('task_get', { taskId: 't-0000' });
      expect(result.status).toBe('ok');
      return outputOf(result);
    };

    const running = await read({
      agentRuns: [
        run({
          status: 'running',
          settledAt: null,
          feedback: 'Answer a-9 to q-1',
        }),
      ],
    });
    expect((running.agentRuns as Record<string, unknown>[])[0]).toEqual({
      runId: 'run-2',
      agentId: 'agent-impl',
      status: 'running',
      live: true,
      trigger: 'manual',
      startedAt: '2026-09-21T14:13:20.000Z',
      launchedAt: '2026-09-21T14:13:21.000Z',
      feedback: 'Answer a-9 to q-1',
    });

    const queued = await read({
      agentRuns: [
        run({
          status: 'queued',
          launchedAt: null,
          settledAt: null,
          waitingForCapacity: true,
        }),
      ],
    });
    expect((queued.agentRuns as Record<string, unknown>[])[0]).toMatchObject({
      live: true,
      waitingForCapacity: true,
    });

    for (const status of ['settled', 'failed', 'cancelled']) {
      const finished = await read({
        agentRuns: [
          run({
            status,
            failureCode: status === 'failed' ? 'harness_error' : null,
            feedback: 'x'.repeat(500),
            feedbackTruncated: true,
          }),
        ],
      });
      const view = (finished.agentRuns as Record<string, unknown>[])[0];
      expect(view).toMatchObject({
        status,
        live: false,
        settledAt: '2026-09-21T14:23:20.000Z',
        feedbackTruncated: true,
      });
      expect(view?.failureCode).toBe(
        status === 'failed' ? 'harness_error' : undefined,
      );
      // Identity, status and timing — never the transcript or the run's
      // workspace handles.
      for (const hidden of [
        'error',
        'resultText',
        'execId',
        'sessionId',
        'agentSessionId',
        'model',
        'harness',
        'startedBy',
        'seq',
      ]) {
        expect(view).not.toHaveProperty(hidden);
      }
    }

    const asking = await read({
      workflowRun: {
        runId: 'wf-1',
        automation: 'intake',
        status: 'waiting',
        live: true,
        waitingFor: 'ask',
        ask: {
          askId: 'ask-1',
          createdAt: 1_790_000_000_000,
          expiresAt: 1_790_604_800_000,
        },
      },
    });
    expect(asking.workflowRun).toEqual({
      runId: 'wf-1',
      automation: 'intake',
      status: 'waiting',
      live: true,
      waitingFor: 'ask',
      ask: {
        askId: 'ask-1',
        askedAt: '2026-09-21T14:13:20.000Z',
        expiresAt: '2026-09-28T14:13:20.000Z',
      },
    });

    const approving = await read({
      workflowRun: {
        runId: 'wf-2',
        automation: 'intake',
        status: 'waiting',
        live: true,
        waitingFor: 'approval',
        approvalId: 'appr-1',
      },
    });
    expect(approving.workflowRun).toMatchObject({
      waitingFor: 'approval',
      approvalId: 'appr-1',
    });

    const reviewing = await read({
      pendingReview: {
        approvalId: 'rev-1',
        round: 2,
        runId: 'run-2',
        requestedFor: 'user-9',
        createdAt: 1_790_000_600_000,
      },
    });
    expect(reviewing.pendingReview).toEqual({
      approvalId: 'rev-1',
      round: 2,
      runId: 'run-2',
      requestedFor: 'user-9',
      since: '2026-09-21T14:23:20.000Z',
    });
  });

  it('answers a failed run-state read as an error, never as an idle task', async () => {
    const { harness, call } = createHarness();
    harness.workState = () => {
      throw new Error('connection terminated');
    };
    const thrown = await call('task_get', { taskId: 't-0000' });
    expect(thrown.status).toBe('error');
    expect(thrown).not.toHaveProperty('output');
    harness.workState = () => null;
    const empty = await call('task_get', { taskId: 't-0000' });
    expect(empty).toEqual({
      status: 'error',
      message: expect.stringContaining('do not treat it as idle'),
    });
  });

  it('refuses a task outside the scope before judging its cursors', async () => {
    const { call, called } = createHarness();
    const foreign = await call('task_get', {
      taskId: 't-foreign',
      commentCursor: 'garbage',
    });
    const missing = await call('task_get', { taskId: 'nope' });
    expect(foreign.status).toBe('not_found');
    expect(foreign).toEqual(missing);
    expect(called('getTaskContextForAgent')).toHaveLength(0);
    expect(called('getTaskWorkStateForAgent')).toHaveLength(0);
  });
});
