// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from './query-keys';
import {
  taskPaginatedAdapters,
  taskReadAdapters,
  taskWriteAdapters,
} from './tasks';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
}

/** A full backend task row (nulls where the 0.4 doc has absent fields). */
function wireTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    organizationId: 'org-1',
    projectId: 'p1',
    title: 'Fix the door',
    description: null,
    attachments: null,
    outputs: null,
    number: 7,
    status: 'todo',
    priority: null,
    labelIds: ['l1'],
    labels: [{ id: 'l1', name: 'bug', color: '#f00' }],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'aa',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    createdBy: 'u1',
    createdByType: 'user',
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
    folderExists: true,
    hasFiles: false,
    ...overrides,
  };
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('task read adapters', () => {
  it('lists the board with filters in the URL and the key, rows projected', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        tasks: [wireTask()],
        truncated: false,
        canEdit: true,
      }),
    );

    const row = taskReadAdapters['tasks/queries:listTasksByProject']?.(
      {
        organizationId: 'org-1',
        projectId: 'p1',
        statuses: ['todo', 'backlog'],
        assigneeId: 'u1',
      },
      {},
    );
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'task',
      'by-project',
      'p1',
      false,
      '',
      'todo,backlog',
      'u1',
      '',
      '',
    ]);
    const result = (await row?.queryFn()) as {
      tasks: Record<string, unknown>[];
      truncated: boolean;
      canEdit: boolean;
    };
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/tasks/by-project/p1?includeArchived=false&statuses=todo%2Cbacklog&assigneeId=u1&orgId=org-1',
      expect.anything(),
    );
    const view = result.tasks[0];
    expect(view?._id).toBe('t1');
    expect(view?._creationTime).toBe(1000);
    expect(view).not.toHaveProperty('description');
    expect(view).not.toHaveProperty('assigneeId');
    expect(view?.labels).toEqual([{ id: 'l1', name: 'bug', color: '#f00' }]);
    expect(view?.folderExists).toBe(true);
    expect(view).not.toHaveProperty('id');
    expect(result.canEdit).toBe(true);
  });

  // Home's "waiting for your review" read: the reviewer filter reaches the
  // URL, and keys its own cache entry apart from the assignee read.
  it('carries the reviewer filter into the URL and the key across projects', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { tasks: [], truncated: false, canEdit: false }),
      );

    const row = taskReadAdapters[
      'tasks/queries:listTasksForAccessibleProjects'
    ]?.(
      { organizationId: 'org-1', statuses: ['in_review'], reviewerId: 'u1' },
      {},
    );
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'task',
      'across-projects',
      false,
      '',
      'in_review',
      '',
      'u1',
      '',
    ]);
    await row?.queryFn();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/tasks?includeArchived=false&statuses=in_review&reviewerId=u1&orgId=org-1',
      expect.anything(),
    );
  });

  // A start or due date stored before the doors held it to the epoch bound
  // (`9e15`: a safe integer, and no `Date` holds it) reads as none, so the
  // card shows no chip and the detail sheet's date picker — which throws
  // formatting an invalid month when opened — gets no value.
  it('reads a stored date no Date can hold as none', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        task: wireTask({ startDate: 9e15, dueDate: 1_790_400_000_000 }),
        canEdit: true,
        canComment: true,
      }),
    );
    const detail = (await taskReadAdapters['tasks/queries:getTask']?.(
      { organizationId: 'org-1', taskId: 't1' },
      {},
    )?.queryFn()) as { task: Record<string, unknown> };
    expect(detail.task).not.toHaveProperty('startDate');
    expect(detail.task.dueDate).toBe(1_790_400_000_000);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        tasks: [wireTask({ startDate: 1_000, dueDate: 9e15 })],
        truncated: false,
        canEdit: true,
      }),
    );
    const board = (await taskReadAdapters['tasks/queries:listTasksByProject']?.(
      { organizationId: 'org-1', projectId: 'p1' },
      {},
    )?.queryFn()) as {
      tasks: Record<string, unknown>[];
    };
    expect(board.tasks[0]?.startDate).toBe(1_000);
    expect(board.tasks[0]).not.toHaveProperty('dueDate');
  });

  // The stored rule is read back leniently: a valid one arrives normalized,
  // one that no longer validates (a zone the runtime dropped) reads as none,
  // and the closed task names the copy it produced.
  it('carries a repeat rule and the next copy, dropping a rule that no longer validates', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        tasks: [
          wireTask({
            repeat: {
              frequency: 'weekly',
              interval: 1,
              weekdays: [4, 1],
              timezone: 'Europe/Zurich',
            },
            repeatNextTaskId: 't2',
          }),
          wireTask({
            id: 't3',
            repeat: {
              frequency: 'daily',
              interval: 1,
              timezone: 'Mars/Olympus_Mons',
            },
          }),
        ],
        truncated: false,
        canEdit: true,
      }),
    );
    const board = (await taskReadAdapters['tasks/queries:listTasksByProject']?.(
      { organizationId: 'org-1', projectId: 'p1' },
      {},
    )?.queryFn()) as { tasks: Record<string, unknown>[] };
    expect(board.tasks[0]?.repeat).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 4],
      timezone: 'Europe/Zurich',
    });
    expect(board.tasks[0]?.repeatNextTaskId).toBe('t2');
    expect(board.tasks[1]).not.toHaveProperty('repeat');
    expect(board.tasks[1]).not.toHaveProperty('repeatNextTaskId');
  });

  // Whether a task continued its series outlives the next task: its delete
  // clears the pointer, never the flag. Absent while the task has not.
  it('carries that a task continued its series, even once its next task is gone', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        tasks: [
          wireTask({ repeatNextTaskId: 't2', repeatContinued: true }),
          wireTask({ id: 't3', repeatContinued: true }),
          wireTask({ id: 't4' }),
        ],
        truncated: false,
        canEdit: true,
      }),
    );
    const board = (await taskReadAdapters['tasks/queries:listTasksByProject']?.(
      { organizationId: 'org-1', projectId: 'p1' },
      {},
    )?.queryFn()) as { tasks: Record<string, unknown>[] };
    expect(board.tasks[0]?.repeatContinued).toBe(true);
    expect(board.tasks[1]?.repeatContinued).toBe(true);
    expect(board.tasks[1]).not.toHaveProperty('repeatNextTaskId');
    expect(board.tasks[2]).not.toHaveProperty('repeatContinued');
  });

  it('maps a missing task detail to null — the 0.4 answer', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(404, { error: 'TASK_NOT_FOUND' }),
    );

    const row = taskReadAdapters['tasks/queries:getTask']?.(
      { organizationId: 'org-1', taskId: 't-gone' },
      {},
    );
    await expect(row?.queryFn()).resolves.toBeNull();
  });

  // The discussion is a newest-first PAGE walk: the cursor from one page is
  // sent for the next, and each wire row is projected with nulls stripped —
  // the shape a fixed 200-message read could never grow into.
  it('walks the discussion newest-first by cursor with nulls stripped', async () => {
    // A fresh Response per call — a body reads once.
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, {
          threadId: 'th1',
          page: [
            {
              messageId: 'm1',
              authorType: 'user',
              authorId: 'u1',
              body: 'hello',
              createdAt: 5,
              editedAt: null,
              mentions: null,
              bodyByLocale: null,
            },
          ],
          isDone: false,
          continueCursor: '41',
        }),
      ),
    );

    const row = taskPaginatedAdapters['tasks/queries:listTaskDiscussion']?.(
      { organizationId: 'org-1', taskId: 't1' },
      {},
    );
    const first = await row?.fetchPage(null, 50);
    expect(first).toEqual({
      page: [
        {
          messageId: 'm1',
          authorType: 'user',
          authorId: 'u1',
          body: 'hello',
          createdAt: 5,
        },
      ],
      isDone: false,
      continueCursor: '41',
    });
    await row?.fetchPage('41', 50);
    const urls = fetchSpy.mock.calls.map(([input]) =>
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    expect(urls[0]).toBe('/api/app/tasks/t1/comments?numItems=50&orgId=org-1');
    expect(urls[1]).toBe(
      '/api/app/tasks/t1/comments?numItems=50&cursor=41&orgId=org-1',
    );
  });
});

describe('task write adapters', () => {
  it('moves by neighbour cards through the move verb', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));

    await taskWriteAdapters['tasks/mutations:moveTask']?.run(
      { taskId: 't1', status: 'in_progress', afterTaskId: 't2' },
      { organizationId: 'org-route' },
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/tasks/t1/move?orgId=org-route');
    expect(jsonBody(init)).toEqual({
      status: 'in_progress',
      afterTaskId: 't2',
    });
  });

  // Closing a repeating task answers the copy it produced, so the app can
  // say so; nulls become absent fields, as on every task.
  it('answers the next copy a status change produced', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        nextTask: { id: 't2', number: 12, dueDate: null },
      }),
    );
    await expect(
      taskWriteAdapters['tasks/mutations:updateTaskStatus']?.run(
        { taskId: 't1', status: 'done' },
        { organizationId: 'org-1' },
      ),
    ).resolves.toEqual({ nextTask: { id: 't2', number: 12 } });
  });

  it('answers no next copy for a move that closed nothing repeating', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true }),
    );
    await expect(
      taskWriteAdapters['tasks/mutations:moveTask']?.run(
        { taskId: 't1', status: 'done' },
        { organizationId: 'org-1' },
      ),
    ).resolves.toEqual({});
  });

  it('keeps the other verbs answering null', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true }),
    );
    await expect(
      taskWriteAdapters['tasks/mutations:archiveTask']?.run(
        { taskId: 't1' },
        { organizationId: 'org-1' },
      ),
    ).resolves.toBeNull();
  });

  // "Stop repeating" is posted against the task whose close created the
  // next one, and answers whether that untouched next task was taken back.
  it.each([
    [{ ok: true, removedNextTask: true }, true],
    [{ ok: true, removedNextTask: false }, false],
    [{ ok: true }, false],
  ])(
    'stops a series through the repeat/stop verb (%o)',
    async (answer, removedNextTask) => {
      const fetchSpy = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(jsonResponse(200, answer));

      await expect(
        taskWriteAdapters['tasks/mutations:stopTaskRepeat']?.run(
          { taskId: 't1', nextTaskId: 't2' },
          { organizationId: 'org-1' },
        ),
      ).resolves.toEqual({ removedNextTask });
      const [url, init] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe('/api/app/tasks/t1/repeat/stop?orgId=org-1');
      expect(init?.method).toBe('POST');
      // The next task's id is the client's own bookkeeping, never sent.
      expect(jsonBody(init)).toEqual({});
    },
  );

  // The closed task's rule is gone, so every task read refreshes — except
  // the next task's own: it may have been taken back, and a refetch of a
  // task that is gone only logs a failed request.
  it('refreshes the task reads after a series is stopped, holding back the next task', () => {
    const client = new QueryClient();
    const board = backendKey('org-1', 'task', 'by-project', 'p1');
    const closed = backendKey('org-1', 'task', 'detail', 't1');
    const next = backendKey('org-1', 'task', 'detail', 't2');
    client.setQueryData(board, []);
    client.setQueryData(closed, {});
    client.setQueryData(next, {});

    taskWriteAdapters['tasks/mutations:stopTaskRepeat']?.invalidate?.(
      client,
      { taskId: 't1', nextTaskId: 't2' },
      { organizationId: 'org-1' },
    );

    expect(client.getQueryState(board)?.isInvalidated).toBe(true);
    expect(client.getQueryState(closed)?.isInvalidated).toBe(true);
    expect(client.getQueryState(next)?.isInvalidated).toBe(false);
  });

  it('deletes a label with the detach flag on the query string', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));

    await taskWriteAdapters['tasks/mutations:deleteTaskLabel']?.run(
      { labelId: 'l1', detach: true },
      { organizationId: 'org-1' },
    );
    const [url] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/tasks/labels/l1?detach=true&orgId=org-1');
  });

  it('refreshes every task read after a delete except the deleted task', () => {
    // The dialog showing the deleted task closes as soon as the delete
    // lands; refetching its reads would only answer 404s under it.
    const client = new QueryClient();
    const board = backendKey('org-1', 'task', 'by-project', 'p1');
    const deleted = backendKey('org-1', 'task', 'detail', 't1');
    client.setQueryData(board, []);
    client.setQueryData(deleted, {});

    taskWriteAdapters['tasks/mutations:deleteTask']?.invalidate?.(
      client,
      { taskId: 't1' },
      { organizationId: 'org-1' },
    );

    expect(client.getQueryState(board)?.isInvalidated).toBe(true);
    expect(client.getQueryState(deleted)?.isInvalidated).toBe(false);
  });

  it('creates a task and answers the new id', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { taskId: 't-new' }),
    );

    await expect(
      taskWriteAdapters['tasks/mutations:createTask']?.run(
        { organizationId: 'org-1', projectId: 'p1', title: 'New' },
        {},
      ),
    ).resolves.toBe('t-new');
  });
});
