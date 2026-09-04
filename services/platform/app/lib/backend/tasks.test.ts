// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('answers the claim result as data', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { claimed: false, reason: 'ALREADY_CLAIMED' }),
    );

    await expect(
      taskWriteAdapters['tasks/mutations:claimTask']?.run(
        { taskId: 't1' },
        { organizationId: 'org-1' },
      ),
    ).resolves.toEqual({ claimed: false, reason: 'ALREADY_CLAIMED' });
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
