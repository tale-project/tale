import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getProjectAuthContext,
  loadProjectOrThrow,
} from '../projects/service.ts';
import { addTaskComment, listTaskComments } from '../tasks/comments.ts';
import { pgTaskStore } from './task-store.ts';

vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));
vi.mock('../tasks/comments.ts', () => ({
  addTaskComment: vi.fn(),
  listTaskComments: vi.fn(),
  TASK_COMMENT_PAGE_MAX: 200,
}));

beforeEach(() => {
  vi.mocked(getProjectAuthContext).mockReset();
  vi.mocked(addTaskComment).mockReset();
  vi.mocked(listTaskComments).mockReset();
});

/**
 * `task.get` answers `null` for exactly one thing — the task does not exist
 * in the org. Regression: the store wrapped the load in `catch { return
 * null }`, so a lost connection or an exhausted pool read as "task not
 * found" and a workflow acted on a phantom miss.
 */

/** A `Sql` stand-in for the one read `get` performs: the tagged-template
 * call answers `rows`, or rejects with `failure`. */
function sqlStub(outcome: { rows?: unknown[]; failure?: Error }): Sql {
  const call = (): Promise<unknown[]> =>
    outcome.failure
      ? Promise.reject(outcome.failure)
      : Promise.resolve(outcome.rows ?? []);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store touches only the tagged call and `unsafe` on this path
  return Object.assign(call, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

describe('pgTaskStore.get', () => {
  it('answers null when the org holds no such task', async () => {
    const store = pgTaskStore(sqlStub({ rows: [] }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'missing' }),
    ).resolves.toBeNull();
  });

  it('answers the task view when the row exists', async () => {
    const store = pgTaskStore(
      sqlStub({
        rows: [
          {
            id: 'task-1',
            title: 'Ship it',
            status: 'todo',
            description: null,
            projectId: 'project-1',
          },
        ],
      }),
    );
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).resolves.toEqual({
      taskId: 'task-1',
      title: 'Ship it',
      status: 'todo',
      projectId: 'project-1',
    });
  });

  it('preserves external linkage for issue automation follow-up', async () => {
    const external = {
      externalSystem: 'github',
      externalId: 'example/web#1',
      externalUrl: 'https://github.com/example/web/issues/1',
    };
    const store = pgTaskStore(
      sqlStub({
        rows: [
          {
            id: 'task-1',
            title: 'Issue',
            status: 'backlog',
            description: null,
            projectId: 'project-1',
            ...external,
          },
        ],
      }),
    );
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).resolves.toMatchObject(external);
  });

  it('propagates a database failure instead of calling it "not found"', async () => {
    const failure = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    const store = pgTaskStore(sqlStub({ failure }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).rejects.toBe(failure);
  });
});

describe('pgTaskStore.get exact run metadata', () => {
  const task = {
    id: 'task-1',
    title: 'Check',
    status: 'todo',
    description: null,
    projectId: 'project-1',
  };
  const run = {
    id: 'run-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    status: 'running',
    execId: 'current-exec',
    startedAt: 10,
    launchedAt: 11,
    settledAt: null,
    sessionId: 'private-session',
    harness: 'private-harness',
    error: 'private-output',
    brokerTokenHash: 'private-stamp',
  };
  function reader(row: unknown = run, failure?: Error) {
    const read = vi.fn().mockResolvedValueOnce([task]);
    if (failure !== undefined) read.mockRejectedValueOnce(failure);
    else read.mockResolvedValueOnce(row === null ? [] : [row]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the real readers use only the tag and unsafe on this bounded path
    const sql = Object.assign(read, {
      unsafe: (text: string) => text,
    }) as unknown as Sql;
    return { store: pgTaskStore(sql), read };
  }

  it('projects the requested task run and no workspace/provider payload', async () => {
    const { store, read } = reader();
    await expect(
      store.get({
        organizationId: 'org-1',
        taskId: 'task-1',
        agentRunId: 'run-1',
      }),
    ).resolves.toEqual({
      taskId: 'task-1',
      title: 'Check',
      status: 'todo',
      projectId: 'project-1',
      agentRun: {
        id: 'run-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        status: 'running',
        execId: 'current-exec',
        startedAt: 10,
        launchedAt: 11,
        settledAt: null,
      },
    });
    expect(read).toHaveBeenCalledTimes(2);
    const [query, ...values] = read.mock.calls[1] ?? [];
    expect(query.join('?')).toContain('WHERE id = ? AND org_id = ?');
    expect(query.join('?')).not.toMatch(
      /result_text|feedback|model|broker_token_hash|session_id/,
    );
    expect(values).toContain('run-1');
    expect(values).toContain('org-1');
  });

  it.each([
    null,
    { ...run, id: 'another-run' },
    { ...run, organizationId: 'org-2' },
    { ...run, projectId: 'project-2' },
    { ...run, taskId: 'task-2' },
  ])('keeps an absent or nonmatching run unknown: %j', async (row) => {
    const { store } = reader(row);
    const result = await store.get({
      organizationId: 'org-1',
      taskId: 'task-1',
      agentRunId: 'run-1',
    });
    expect(result).toHaveProperty('agentRun', null);
  });

  it('does not read run metadata when omitted', async () => {
    const { store, read } = reader();
    const result = await store.get({
      organizationId: 'org-1',
      taskId: 'task-1',
    });
    expect(result).not.toHaveProperty('agentRun');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not read any run before the task itself is found in the organization', async () => {
    const read = vi.fn().mockResolvedValue([]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the task reader only uses the tag and unsafe
    const sql = Object.assign(read, {
      unsafe: (text: string) => text,
    }) as unknown as Sql;
    await expect(
      pgTaskStore(sql).get({
        organizationId: 'org-1',
        taskId: 'missing',
        agentRunId: 'run-1',
      }),
    ).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('propagates run-read failure rather than inventing a missing run', async () => {
    const failure = new Error('connection terminated');
    const { store } = reader(null, failure);
    await expect(
      store.get({
        organizationId: 'org-1',
        taskId: 'task-1',
        agentRunId: 'run-1',
      }),
    ).rejects.toBe(failure);
  });
});

describe('pgTaskStore.comment', () => {
  /** The `task.comment` native validates `bodyByLocale` (one narrator per
   * language) and the reader picks their locale from it; the store used to
   * drop it on the floor, so every localized workflow comment rendered
   * English-only. */
  it('forwards the by-locale bodies to the comment writer', async () => {
    const auth = {
      organizationId: 'org-1',
      userId: 'system',
      role: 'owner' as const,
      teamIds: [],
    };
    vi.mocked(getProjectAuthContext).mockResolvedValue(auth);
    vi.mocked(addTaskComment).mockResolvedValue({
      messageId: 'm-1',
      threadId: 'th-1',
      unresolvedMentionTokens: [],
    });
    const tx = sqlStub({ rows: [] });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `begin` runs the callback on the same stand-in
    const sql = Object.assign(tx, {
      begin: (callback: (tx: Sql) => unknown) => callback(tx),
    }) as unknown as Sql;
    const store = pgTaskStore(sql);

    await expect(
      store.comment({
        organizationId: 'org-1',
        taskId: 'task-1',
        body: 'Done.',
        bodyByLocale: { en: 'Done.', de: 'Erledigt.', fr: 'Terminé.' },
      }),
    ).resolves.toEqual({ messageId: 'm-1' });

    expect(addTaskComment).toHaveBeenCalledWith(tx, auth, {
      taskId: 'task-1',
      body: 'Done.',
      bodyByLocale: { en: 'Done.', de: 'Erledigt.', fr: 'Terminé.' },
      author: { actorType: 'agent', actorId: 'workflow' },
    });
  });

  it('leaves bodyByLocale out when the native sent none', async () => {
    vi.mocked(getProjectAuthContext).mockResolvedValue({
      organizationId: 'org-1',
      userId: 'system',
      role: 'owner',
      teamIds: [],
    });
    vi.mocked(addTaskComment).mockResolvedValue({
      messageId: 'm-2',
      threadId: 'th-1',
      unresolvedMentionTokens: [],
    });
    const tx = sqlStub({ rows: [] });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `begin` runs the callback on the same stand-in
    const sql = Object.assign(tx, {
      begin: (callback: (tx: Sql) => unknown) => callback(tx),
    }) as unknown as Sql;
    await pgTaskStore(sql).comment({
      organizationId: 'org-1',
      taskId: 'task-1',
      body: 'Done.',
    });
    const [, , args] = vi.mocked(addTaskComment).mock.calls[0] ?? [];
    expect(args).not.toHaveProperty('bodyByLocale');
  });
});

it('preserves localized workflow comments through native readback', async () => {
  const bodies = {
    en: 'Checked.',
    de: 'Geprüft.',
    fr: 'Vérifié.',
    nl: 'Gecontroleerd.',
  };
  vi.mocked(getProjectAuthContext).mockResolvedValue({
    organizationId: 'org-1',
    userId: 'system',
    role: 'owner',
    teamIds: [],
  });
  vi.mocked(listTaskComments).mockResolvedValue({
    comments: [
      {
        messageId: 'm-1',
        authorType: 'agent',
        authorId: 'workflow',
        body: 'Checked.',
        bodyByLocale: bodies,
        createdAt: 3,
        editedAt: null,
        mentions: [],
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
  const result = await pgTaskStore(sqlStub({ rows: [] })).listComments({
    organizationId: 'org-1',
    taskId: 'task-1',
  });
  expect(result.comments[0]).toMatchObject({
    body: 'Checked.',
    bodyByLocale: bodies,
  });
  expect(result.comments[0]).not.toHaveProperty('messageId');
  const identified = await pgTaskStore(sqlStub({ rows: [] })).listComments({
    organizationId: 'org-1',
    taskId: 'task-1',
    includeIds: true,
  });
  expect(identified.comments[0]).toMatchObject({
    messageId: 'm-1',
    body: 'Checked.',
    bodyByLocale: bodies,
    authorType: 'agent',
    authorId: 'workflow',
  });
});

it('reads each comment as stored and as text with current names [COLLAB-R10]', async () => {
  vi.mocked(getProjectAuthContext).mockResolvedValue({
    organizationId: 'org-1',
    userId: 'system',
    role: 'owner',
    teamIds: [],
  });
  const body = '[@Ada](mention:user/u-1) please check';
  vi.mocked(listTaskComments).mockResolvedValue({
    comments: [
      {
        messageId: 'm-1',
        authorType: 'user',
        authorId: 'u-2',
        body,
        bodyByLocale: null,
        createdAt: 3,
        editedAt: null,
        mentions: [{ type: 'user', id: 'u-1' }],
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
  // The one read the store makes here: the current name of who is named.
  const store = pgTaskStore(
    sqlStub({ rows: [{ id: 'u-1', name: 'Ada Lovelace', email: null }] }),
  );
  const result = await store.listComments({
    organizationId: 'org-1',
    taskId: 'task-1',
  });
  expect(result.comments[0]).toMatchObject({
    body,
    bodyText: '@Ada Lovelace please check',
  });
});

describe('pgTaskStore.list', () => {
  it('names an agent another project’s dispatch put on the board [TASK-R76]', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the listing reads only these fields of the project
      {
        id: 'p-billing',
        organizationId: 'org-1',
        archivedAt: null,
      } as unknown as Awaited<ReturnType<typeof loadProjectOrThrow>>,
    );
    const statements: string[] = [];
    const tx = Object.assign(
      (strings: TemplateStringsArray) => {
        const text = strings.join('?');
        statements.push(text);
        return Promise.resolve(
          text.includes('FROM app.tasks t')
            ? [
                {
                  taskId: 'task-1',
                  number: 7,
                  title: 'Fix the importer',
                  status: 'todo',
                  priority: null,
                  assigneeType: 'agent',
                  assigneeId: 'coder',
                  assigneeName: 'Coder',
                  dueDateMs: null,
                  createdAtMs: 1,
                },
              ]
            : [],
        );
      },
      { unsafe: (text: string) => text },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the listing touches only `begin` and the transaction's tagged calls
    const sql = {
      begin: (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as Sql;
    const listed = await pgTaskStore(sql).list({
      organizationId: 'org-1',
      caller: { kind: 'system', reason: 'test' },
      projectId: 'p-billing',
      limit: 10,
    });
    expect(listed).toMatchObject({
      ok: true,
      tasks: [{ assignee: { type: 'agent', id: 'coder', name: 'Coder' } }],
    });
    // The agent is joined by its id in the organization, never by the
    // board's project: the Coder is Development's.
    const listing = statements.find((text) =>
      text.includes('FROM app.tasks t'),
    );
    expect(listing).toContain('a.org_id = t.org_id');
    expect(listing).not.toContain('a.project_id = t.project_id');
  });
});
