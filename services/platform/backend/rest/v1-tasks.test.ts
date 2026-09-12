// @vitest-environment node

import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mintCursorFor, type RestEnv } from './shared.ts';
import { createTaskRestRoutes } from './v1-tasks.ts';

const service = vi.hoisted(() => ({
  findTaskByExternalRef: vi.fn(),
  upsertTaskByExternalRef: vi.fn(),
  startWorkflowForTask: vi.fn(),
  startWorkflowForTaskInTx: vi.fn(),
  addTaskComment: vi.fn(),
  listTaskComments: vi.fn(),
}));

vi.mock('../domains/tasks/external-ref.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/tasks/external-ref.ts')
  >()),
  findTaskByExternalRef: service.findTaskByExternalRef,
  upsertTaskByExternalRef: service.upsertTaskByExternalRef,
  startWorkflowForTask: service.startWorkflowForTask,
  startWorkflowForTaskInTx: service.startWorkflowForTaskInTx,
}));
vi.mock('../domains/tasks/comments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/comments.ts')>()),
  addTaskComment: service.addTaskComment,
  listTaskComments: service.listTaskComments,
}));

interface Captured {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  teamId: 'team-1',
  sharedWithTeamIds: [],
  archivedAt: null,
};
const task = {
  id: 't-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  title: 'Prepare the Q1 filing',
  status: 'backlog',
  labelIds: [],
  externalSystem: 'github',
  externalId: 'issue-7',
  externalUrl: null,
  createdAt: 1,
  updatedAt: 2,
  archivedAt: null,
};
const input = {
  externalSystem: 'github',
  externalId: 'issue-7',
  title: 'Prepare the Q1 filing',
};
const collection = '/projects/p-1/tasks';
const item = `${collection}/t-1`;
const operations = [
  { method: 'GET', path: item },
  { method: 'GET', path: `${item}/comments` },
  { method: 'POST', path: `${item}/comments`, body: { body: 'Filed.' } },
  { method: 'POST', path: `${item}/start`, body: { workflowSlug: 'triage' } },
];

function mount(
  options: {
    role?: string;
    teamIds?: string[];
    foreign?: boolean;
    absent?: boolean;
    taskAbsent?: boolean;
    taskProjectId?: string;
    taskProjectIdInTx?: string;
    archived?: boolean;
    archivedInTx?: boolean;
    absentInTx?: boolean;
    taskArchived?: boolean;
    projectFailure?: boolean;
    ambiguous?: boolean;
    spent?: boolean;
    deployed?: boolean;
    boundProjectIds?: string[];
  } = {},
) {
  const queries: Captured[] = [];
  const execute = (
    inTransaction: boolean,
    strings: TemplateStringsArray,
    values: unknown[],
  ) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values, inTransaction });
    if (text.includes('FROM "teamMember"')) {
      return Promise.resolve(
        (options.teamIds ?? ['team-1']).map((teamId) => ({ teamId })),
      );
    }
    if (text.includes('FROM "member"')) {
      return Promise.resolve([
        { organizationId: 'org-1', role: 'admin' },
        { organizationId: 'org-2', role: 'admin' },
      ]);
    }
    if (text.includes('FROM app.tasks WHERE id')) {
      return Promise.resolve(
        options.taskAbsent
          ? []
          : [
              {
                ...task,
                projectId:
                  (inTransaction ? options.taskProjectIdInTx : undefined) ??
                  options.taskProjectId ??
                  'p-1',
                archivedAt: options.taskArchived ? 1 : null,
              },
            ],
      );
    }
    if (text.includes('FROM app.projects WHERE id')) {
      if (options.projectFailure)
        return Promise.reject(new Error('database unavailable'));
      return Promise.resolve(
        options.absent || (inTransaction && options.absentInTx)
          ? []
          : [
              {
                ...project,
                organizationId: options.foreign ? 'other-org' : 'org-1',
                archivedAt:
                  options.archived || (inTransaction && options.archivedInTx)
                    ? 1
                    : null,
              },
            ],
      );
    }
    if (text.includes('FROM app.automation_deployments')) {
      return Promise.resolve(
        options.deployed === false ? [] : [{ version: 1 }],
      );
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return Promise.resolve(
        (options.boundProjectIds ?? ['p-1']).map((projectId) => ({
          projectId,
        })),
      );
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve(options.spent ? [] : [{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    execute(false, strings, values);
  const tx = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      execute(true, strings, values),
    { unsafe },
  ) as unknown as TransactionSql;
  const begin = vi.fn(
    (_options: string, callback: (tx: TransactionSql) => Promise<unknown>) =>
      callback(tx),
  );
  const sql = Object.assign(tag, { unsafe, begin }) as unknown as Sql;
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'admin');
    c.set('orgExplicit', options.ambiguous !== true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createTaskRestRoutes({ sql }));
  const request = (path: string, method = 'GET', body?: unknown) =>
    app.request(`http://localhost${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }),
    });
  return { request, queries, sql, tx, begin };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.findTaskByExternalRef.mockResolvedValue(null);
  service.upsertTaskByExternalRef.mockResolvedValue({
    taskId: 't-1',
    created: true,
  });
  service.startWorkflowForTask.mockResolvedValue({
    runId: 'run-1',
    alreadyRunning: false,
  });
  service.startWorkflowForTaskInTx.mockResolvedValue({
    runId: 'run-1',
    alreadyRunning: false,
  });
  service.addTaskComment.mockResolvedValue({ messageId: 'comment-1' });
  service.listTaskComments.mockResolvedValue({
    comments: [
      {
        messageId: 'comment-1',
        authorType: 'user',
        authorId: 'user-1',
        body: 'Filed.',
        createdAt: 3,
        editedAt: null,
      },
    ],
    hasMore: true,
    nextCursor: 12,
  });
});

describe('project-scoped task intake', () => {
  it('creates using the path project and checks it again inside the transaction', async () => {
    const { request, queries, tx, begin } = mount();
    const res = await request(collection, 'POST', input);
    expect(begin).toHaveBeenCalledWith(
      'isolation level serializable',
      expect.any(Function),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ task: { id: 't-1', created: true } });
    expect(service.upsertTaskByExternalRef).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        ...input,
        projectId: 'p-1',
        organizationId: 'org-1',
        actorId: 'user-1',
        creatorType: 'user',
        dedupeScope: 'project',
      }),
    );
    expect(
      queries.some(
        (query) =>
          query.inTransaction && query.text.includes('FROM app.projects'),
      ),
    ).toBe(true);
  });

  it('returns an idempotent existing task without starting another workflow', async () => {
    service.upsertTaskByExternalRef.mockResolvedValue({
      taskId: 't-1',
      created: false,
    });
    const { request } = mount();
    const res = await request(collection, 'POST', {
      ...input,
      runWorkflowSlug: 'triage',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task: { id: 't-1', created: false } });
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['projectId', { ...input, projectId: 'p-2' }],
    ['unknown field', { ...input, arbitrary: true }],
    ['empty automation', { ...input, automationSlug: '' }],
    ['empty workflow', { ...input, runWorkflowSlug: '' }],
    ['malformed JSON', '{'],
  ])('rejects %s without creating a task', async (_name, body) => {
    const { request } = mount();
    expect((await request(collection, 'POST', body)).status).toBe(400);
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  /**
   * The door is a validating boundary: an over-long title is refused by
   * name, never stored clipped (the spec used to promise 2000 characters
   * while the board clipped at 200 with an ellipsis and answered 201); a
   * non-http(s) `externalUrl` never reaches the link it is rendered as.
   */
  it('refuses a title over the board cap and a non-http externalUrl by field', async () => {
    const { request } = mount();
    const long = await request(collection, 'POST', {
      ...input,
      title: 'B'.repeat(201),
    });
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'title' })] },
    });
    const url = await request(collection, 'POST', {
      ...input,
      externalUrl: 'javascript:alert(1)',
    });
    expect(url.status).toBe(400);
    expect(await url.json()).toMatchObject({
      data: { issues: [expect.objectContaining({ path: 'externalUrl' })] },
    });
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
    const ok = await request(collection, 'POST', {
      ...input,
      title: 'B'.repeat(200),
      externalUrl: 'https://crm.example/items/4711',
    });
    expect(ok.status).toBe(201);
  });

  it('carries the external lifecycle state into the intake, open by default', async () => {
    const { request } = mount();
    await request(collection, 'POST', { ...input, externalState: 'closed' });
    expect(service.upsertTaskByExternalRef.mock.calls[0]?.[1]).toMatchObject({
      externalState: 'closed',
    });
    await request(collection, 'POST', input);
    expect(service.upsertTaskByExternalRef.mock.calls[1]?.[1]).toMatchObject({
      externalState: 'open',
    });
  });

  /**
   * A repeat is a reconcile of the existing task, and the docs ask for a
   * stable payload on retry: the run workflow only ever starts a create,
   * so only a create validates its project binding. A repeat that carried
   * a workflow bound to another project used to 403 — and drop the
   * title/description update the retry carried.
   */
  it('does not re-validate runWorkflowSlug on a repeat, and reconciles the task', async () => {
    service.findTaskByExternalRef.mockResolvedValue({ id: 't-1' });
    service.upsertTaskByExternalRef.mockResolvedValue({
      taskId: 't-1',
      created: false,
    });
    const { request } = mount({ boundProjectIds: ['p-other'] });
    const res = await request(collection, 'POST', {
      ...input,
      title: 'Renamed upstream',
      runWorkflowSlug: 'triage',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task: { id: 't-1', created: false } });
    const upsert = service.upsertTaskByExternalRef.mock.calls[0]?.[1];
    expect(upsert).toMatchObject({ title: 'Renamed upstream' });
    expect(upsert).not.toHaveProperty('runWorkflowSlug');
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it('still refuses a create whose workflow is bound to another project', async () => {
    const { request } = mount({ boundProjectIds: ['p-other'] });
    const res = await request(collection, 'POST', {
      ...input,
      runWorkflowSlug: 'triage',
    });
    expect(res.status).toBe(403);
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it('refuses read-only members before any intake or run', async () => {
    const { request } = mount({ role: 'member' });
    expect(
      (
        await request(collection, 'POST', {
          ...input,
          runWorkflowSlug: 'triage',
        })
      ).status,
    ).toBe(403);
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign project', { foreign: true }],
    ['missing project', { absent: true }],
    ['hidden project', { role: 'editor', teamIds: [] }],
    ['deleted during intake', { absentInTx: true }],
  ])('conceals %s and writes nothing', async (_name, options) => {
    const { request } = mount(options);
    expect((await request(collection, 'POST', input)).status).toBe(404);
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it.each([{ archived: true }, { archivedInTx: true }])(
    'refuses an archived project, including archival after preflight: %j',
    async (options) => {
      const { request } = mount(options);
      expect((await request(collection, 'POST', input)).status).toBe(403);
      expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
    },
  );

  it('refuses an execution budget exhaustion before committing intake', async () => {
    const { request, queries } = mount({ spent: true });
    const res = await request(collection, 'POST', {
      ...input,
      runWorkflowSlug: 'triage',
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(
      queries.find((query) =>
        query.text.includes('INSERT INTO app.rate_limits'),
      )?.values,
    ).toContain('rest:execute');
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it('does not charge the execution budget for an ordinary intake', async () => {
    const { request, queries } = mount({ spent: true });
    expect((await request(collection, 'POST', input)).status).toBe(201);
    expect(
      queries.some((query) =>
        query.text.includes('INSERT INTO app.rate_limits'),
      ),
    ).toBe(false);
  });

  it.each(['automationSlug', 'runWorkflowSlug'])(
    'refuses a %s bound elsewhere before intake commits',
    async (field) => {
      const { request } = mount({ boundProjectIds: ['p-2'] });
      expect(
        (await request(collection, 'POST', { ...input, [field]: 'triage' }))
          .status,
      ).toBe(403);
      expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
    },
  );

  it('refuses an undeployed explicit owner before creating an orphan assignment', async () => {
    const { request } = mount({ deployed: false, boundProjectIds: [] });
    expect(
      (await request(collection, 'POST', { ...input, automationSlug: 'ghost' }))
        .status,
    ).toBe(404);
    expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
  });

  it('keeps a committed task successful when an undeployed workflow does not start', async () => {
    service.startWorkflowForTaskInTx.mockResolvedValue(null);
    const { request } = mount({ deployed: false, boundProjectIds: [] });
    const res = await request(collection, 'POST', {
      ...input,
      runWorkflowSlug: 'ghost',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      task: { id: 't-1', created: true },
      runId: null,
      executionId: null,
    });
  });

  it('accepts an organization automation and starts with fresh scoped state in a transaction', async () => {
    const { request, tx } = mount({ boundProjectIds: [] });
    const res = await request(collection, 'POST', {
      ...input,
      automationSlug: 'triage',
      runWorkflowSlug: 'triage',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      task: { id: 't-1', created: true },
      runId: 'run-1',
      executionId: 'run-1',
    });
    expect(service.startWorkflowForTaskInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        task: expect.objectContaining({ id: 't-1', projectId: 'p-1' }),
        startedVia: 'api-key',
      }),
    );
  });
});

describe('project-scoped task reads and operations', () => {
  it('reads a task as a member', async () => {
    const { request } = mount({ role: 'member' });
    const res = await request(item);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      task: { id: 't-1', projectId: 'p-1', title: task.title },
    });
  });

  it.each(operations)(
    'refuses a task in a different same-org project: $method $path',
    async ({ path, method, body }) => {
      const { request, queries } = mount({ taskProjectId: 'p-2' });
      expect((await request(path, method, body)).status).toBe(404);
      expect(service.addTaskComment).not.toHaveBeenCalled();
      expect(service.listTaskComments).not.toHaveBeenCalled();
      expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
      expect(
        queries.some((query) =>
          query.text.includes('INSERT INTO app.rate_limits'),
        ),
      ).toBe(false);
    },
  );

  it.each([
    ['foreign project', { foreign: true }],
    ['missing project', { absent: true }],
    ['missing task', { taskAbsent: true }],
    ['hidden project', { role: 'member', teamIds: [] }],
  ])('conceals %s across all task operations', async (_name, options) => {
    const { request } = mount(options);
    for (const operation of operations) {
      expect(
        (await request(operation.path, operation.method, operation.body))
          .status,
      ).toBe(404);
    }
    expect(service.addTaskComment).not.toHaveBeenCalled();
    expect(service.listTaskComments).not.toHaveBeenCalled();
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it('returns 500 for a database failure instead of concealing it as a missing task', async () => {
    const { request } = mount({ projectFailure: true });
    expect((await request(item)).status).toBe(500);
  });

  it('keeps archived projects readable but refuses comment and execution mutations', async () => {
    const { request } = mount({ archived: true });
    expect((await request(item)).status).toBe(200);
    expect((await request(`${item}/comments`)).status).toBe(200);
    expect(
      (await request(`${item}/comments`, 'POST', { body: 'Filed.' })).status,
    ).toBe(403);
    expect(
      (await request(`${item}/start`, 'POST', { workflowSlug: 'triage' }))
        .status,
    ).toBe(403);
    expect(service.addTaskComment).not.toHaveBeenCalled();
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it.each([
    { path: `${item}/comments`, body: { body: 'Filed.' } },
    { path: `${item}/start`, body: { workflowSlug: 'triage' } },
  ])(
    'rejects scope payload and malformed JSON at $path',
    async ({ path, body }) => {
      const { request } = mount();
      expect(
        (await request(path, 'POST', { ...body, projectId: 'p-2' })).status,
      ).toBe(400);
      expect((await request(path, 'POST', '{')).status).toBe(400);
      expect(service.addTaskComment).not.toHaveBeenCalled();
      expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    { path: `${item}/comments`, body: { body: 'Filed.' } },
    { path: `${item}/start`, body: { workflowSlug: 'triage' } },
  ])(
    'rechecks task binding inside the mutation transaction: $path',
    async ({ path, body }) => {
      const { request } = mount({ taskProjectIdInTx: 'p-2' });
      expect((await request(path, 'POST', body)).status).toBe(404);
      expect(service.addTaskComment).not.toHaveBeenCalled();
      expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    { path: `${item}/comments`, body: { body: 'Filed.' } },
    { path: `${item}/start`, body: { workflowSlug: 'triage' } },
  ])(
    'refuses project archival after preflight at $path',
    async ({ path, body }) => {
      const { request } = mount({ archivedInTx: true });
      expect((await request(path, 'POST', body)).status).toBe(403);
      expect(service.addTaskComment).not.toHaveBeenCalled();
      expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
    },
  );

  it('keeps member comments read-level, under the comment budget and in a transaction', async () => {
    const { request, tx, queries } = mount({ role: 'member' });
    const res = await request(`${item}/comments`, 'POST', { body: 'Filed.' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ comment: { id: 'comment-1' } });
    expect(service.addTaskComment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ role: 'member' }),
      { taskId: 't-1', body: 'Filed.' },
    );
    const charge = queries.find((query) =>
      query.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('task:comment');
    expect(charge?.values).toContain('user:user-1');
    expect(
      queries.some(
        (query) =>
          query.inTransaction && query.text.includes('FROM app.projects'),
      ),
    ).toBe(true);
  });

  it('returns the standard comment 429 without writing', async () => {
    const { request } = mount({ spent: true });
    const res = await request(`${item}/comments`, 'POST', { body: 'Filed.' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(service.addTaskComment).not.toHaveBeenCalled();
  });

  it('preserves comment pagination and rejects malformed cursors', async () => {
    const { request, sql } = mount();
    const list = 'task-comments:t-1';
    const cursor = mintCursorFor('org-1', list, '25');
    const res = await request(
      `${item}/comments?limit=100&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      comments: [
        {
          id: 'comment-1',
          authorType: 'user',
          authorId: 'user-1',
          body: 'Filed.',
          createdAt: 3,
        },
      ],
      isDone: false,
      continueCursor: mintCursorFor('org-1', list, '12'),
    });
    expect(service.listTaskComments).toHaveBeenCalledWith(
      sql,
      expect.any(Object),
      't-1',
      { limit: 100, before: 25 },
    );
    for (const bad of ['abc', '25', mintCursorFor('org-1', 'other', '25')]) {
      const refused = await request(`${item}/comments?cursor=${bad}`);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
    const limit = await request(`${item}/comments?limit=abc`);
    expect(limit.status).toBe(400);
    expect(await limit.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });

  it('refuses a member workflow start', async () => {
    const { request } = mount({ role: 'member' });
    expect(
      (await request(`${item}/start`, 'POST', { workflowSlug: 'triage' }))
        .status,
    ).toBe(403);
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it('starts a workflow under the execution budget with checked project and fresh task in the transaction', async () => {
    const { request, queries, tx } = mount({ role: 'editor' });
    const res = await request(`${item}/start`, 'POST', {
      workflowSlug: 'triage',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      started: true,
      runId: 'run-1',
      executionId: 'run-1',
    });
    expect(service.startWorkflowForTaskInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        task: expect.objectContaining({ id: 't-1', projectId: 'p-1' }),
        startedVia: 'api-key',
      }),
    );
    expect(
      queries.find((query) =>
        query.text.includes('INSERT INTO app.rate_limits'),
      )?.values,
    ).toContain('rest:execute');
    expect(
      queries.some(
        (query) => query.inTransaction && query.text.includes('FROM app.tasks'),
      ),
    ).toBe(true);
  });

  it.each([
    {
      result: null,
      response: {
        started: false,
        reason: 'not_started',
        runId: null,
        executionId: null,
      },
    },
    {
      result: { runId: 'run-live', alreadyRunning: true },
      response: {
        started: false,
        reason: 'already_running',
        runId: 'run-live',
        executionId: 'run-live',
      },
    },
  ])(
    'preserves workflow refusal/idempotence: $response.reason',
    async ({ result, response }) => {
      service.startWorkflowForTaskInTx.mockResolvedValue(result);
      const { request } = mount();
      const res = await request(`${item}/start`, 'POST', {
        workflowSlug: 'triage',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(response);
    },
  );

  it('removes the replaced flat task routes', async () => {
    const { request } = mount();
    expect(
      (await request('/tasks', 'POST', { ...input, projectId: 'p-1' })).status,
    ).toBe(404);
    expect((await request('/tasks/t-1')).status).toBe(404);
    expect((await request('/tasks/t-1/comments')).status).toBe(404);
    expect(
      (await request('/tasks/t-1/comments', 'POST', { body: 'Filed.' })).status,
    ).toBe(404);
    expect(
      (await request('/tasks/t-1/start', 'POST', { workflowSlug: 'triage' }))
        .status,
    ).toBe(404);
  });
});

/**
 * The caller-owned keys are canonical at the door (NFC, trimmed — the one
 * rule the project family's `externalItemId` follows), the run a start
 * answers is named `runId` beside the legacy `executionId`, the URL is
 * judged left to right (a bad project id is `PROJECT_NOT_FOUND`, never the
 * task's fault), and an archived task refuses the mutations the contract
 * promises only "an active task" takes.
 */
describe('project-scoped task door — keys, run ids, URL order, archival', () => {
  it('canonicalizes externalSystem and externalId before the lookup and the intake', async () => {
    const { request } = mount();
    const nfd = 'café'.normalize('NFD');
    const res = await request(collection, 'POST', {
      ...input,
      externalSystem: ' crm ',
      externalId: `  ${nfd}-001\n`,
    });
    expect(res.status).toBe(201);
    expect(service.findTaskByExternalRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalSystem: 'crm',
        externalId: 'café-001',
      }),
    );
    expect(service.upsertTaskByExternalRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalSystem: 'crm',
        externalId: 'café-001',
      }),
    );
  });

  it.each([
    ['externalId', { ...input, externalId: '   ' }, 'must not be blank'],
    ['externalSystem', { ...input, externalSystem: '\n' }, 'must not be blank'],
    ['title', { ...input, title: '   ' }, undefined],
    ['labels.0', { ...input, labels: ['  '] }, undefined],
  ])(
    'refuses a whitespace-only %s by name with 400 INVALID_BODY',
    async (path, body, message) => {
      const { request } = mount();
      const res = await request(collection, 'POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'INVALID_BODY',
        data: {
          issues: [
            expect.objectContaining({
              path,
              ...(message === undefined ? {} : { message }),
            }),
          ],
        },
      });
      expect(service.upsertTaskByExternalRef).not.toHaveBeenCalled();
    },
  );

  it('trims the title and the labels it hands to the intake', async () => {
    const { request } = mount();
    const res = await request(collection, 'POST', {
      ...input,
      title: '  Prepare  ',
      labels: [' ops '],
    });
    expect(res.status).toBe(201);
    expect(service.upsertTaskByExternalRef.mock.calls[0]?.[1]).toMatchObject({
      title: 'Prepare',
      labels: ['ops'],
    });
  });

  it('blames a missing project on the project, before the task is looked up', async () => {
    const { request, queries } = mount({ absent: true, taskAbsent: true });
    const res = await request(item);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(queries.some((query) => query.text.includes('FROM app.tasks'))).toBe(
      false,
    );
    const taskless = await request(item, 'GET', undefined);
    expect(taskless.status).toBe(404);
    const { request: withProject } = mount({ taskAbsent: true });
    const missingTask = await withProject(item);
    expect(missingTask.status).toBe(404);
    expect(await missingTask.json()).toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('keeps an archived task readable but refuses its comment and start with 403 TASK_ARCHIVED', async () => {
    const { request } = mount({ taskArchived: true });
    expect((await request(item)).status).toBe(200);
    expect((await request(`${item}/comments`)).status).toBe(200);
    const comment = await request(`${item}/comments`, 'POST', {
      body: 'Filed.',
    });
    expect(comment.status).toBe(403);
    expect(await comment.json()).toMatchObject({ code: 'TASK_ARCHIVED' });
    const start = await request(`${item}/start`, 'POST', {
      workflowSlug: 'triage',
    });
    expect(start.status).toBe(403);
    expect(await start.json()).toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(service.addTaskComment).not.toHaveBeenCalled();
    expect(service.startWorkflowForTaskInTx).not.toHaveBeenCalled();
  });

  it('refuses a whitespace-only comment body at the door', async () => {
    const { request } = mount();
    const res = await request(`${item}/comments`, 'POST', { body: ' \n ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'body' })] },
    });
    expect(service.addTaskComment).not.toHaveBeenCalled();
  });
});
