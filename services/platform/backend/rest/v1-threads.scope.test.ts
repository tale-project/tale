// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../jobs/enqueue.ts';
import type { RestEnv } from './shared.ts';
import { createThreadRestRoutes } from './v1-threads.ts';

vi.mock('../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
// A send names its provider, and the door holds the pair to what
// `GET /models` lists — scope is what is under test here, so the catalog
// simply carries the pair every send below uses.
vi.mock('../domains/chat/composer.ts', () => ({
  listComposerModels: vi.fn(() =>
    Promise.resolve({
      models: [
        {
          id: 'model-a',
          label: 'Model A',
          providerSlug: 'provider-a',
          providerLabel: 'Provider A',
          credential: { authMethod: 'api-key' },
        },
      ],
      harnesses: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    }),
  ),
}));

interface Query {
  text: string;
  values: unknown[];
  transaction: boolean;
}

const ordinary = {
  id: 't-personal',
  organizationId: 'org-1',
  userId: 'user-1',
  title: 'Personal',
  kind: 'direct',
  harness: null,
  projectId: null as string | null,
  archived: false,
  isShared: null,
  status: 'active',
  hidden: false,
  createdAt: 10,
  updatedAt: 20,
};

const rows = [
  ordinary,
  { ...ordinary, id: 't-a', projectId: 'p-a', updatedAt: 30 },
  { ...ordinary, id: 't-a-older', projectId: 'p-a', updatedAt: 25 },
  { ...ordinary, id: 't-b', projectId: 'p-b', updatedAt: 40 },
  { ...ordinary, id: 't-archived', archived: true },
  { ...ordinary, id: 't-sandbox', kind: 'sandbox' },
  { ...ordinary, id: 't-hidden', projectId: 'p-a', hidden: true },
  { ...ordinary, id: 't-trash', projectId: 'p-a', status: 'trash' },
  { ...ordinary, id: 't-other-user', projectId: 'p-a', userId: 'user-2' },
  { ...ordinary, id: 't-other-org', projectId: 'p-a', organizationId: 'org-2' },
];

function mount(
  options: {
    role?: string;
    unreadable?: boolean;
    archivedProject?: boolean;
    absentProject?: boolean;
    foreignProject?: boolean;
    ambiguous?: boolean;
    changedAtInsert?:
      | 'archived'
      | 'missing'
      | 'foreign'
      | 'unreadable'
      | 'disabled';
  } = {},
) {
  const queries: Query[] = [];
  let transaction = false;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values, transaction });
    const changed = transaction ? options.changedAtInsert : undefined;
    const bound = (prefix: string) =>
      values[strings.findIndex((part) => part.endsWith(prefix))];
    if (text.includes('FROM app.threads t')) {
      let selected = rows.filter(
        (row) =>
          row.organizationId === bound('t.org_id = ') &&
          row.userId === bound('t.user_id = ') &&
          row.status === 'active',
      );
      if (text.includes('t.id = ?'))
        selected = selected.filter((row) => row.id === bound('t.id = '));
      if (text.includes('tm.project_id IS NOT DISTINCT FROM ?')) {
        selected = selected.filter(
          (row) =>
            row.projectId === bound('tm.project_id IS NOT DISTINCT FROM '),
        );
      }
      if (text.includes('tm.hidden IS NOT true'))
        selected = selected.filter((row) => !row.hidden);
      const cursorAt = bound('t.updated_at_ms < ');
      const cursorId = bound('t.id < ');
      if (typeof cursorAt === 'number')
        selected = selected.filter(
          (row) =>
            row.updatedAt < cursorAt ||
            (row.updatedAt === cursorAt &&
              typeof cursorId === 'string' &&
              row.id < cursorId),
        );
      selected.sort(
        (a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id),
      );
      const limit = bound('LIMIT ');
      return Promise.resolve(
        typeof limit === 'number' ? selected.slice(0, limit) : selected,
      );
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve(
        options.absentProject || changed === 'missing'
          ? []
          : [
              {
                id: values.at(-1),
                organizationId:
                  options.foreignProject || changed === 'foreign'
                    ? 'org-2'
                    : 'org-1',
                orgId:
                  options.foreignProject || changed === 'foreign'
                    ? 'org-2'
                    : 'org-1',
                name: 'Project',
                teamId: 'team-1',
                sharedWithTeamIds: [],
                archivedAt:
                  options.archivedProject || changed === 'archived' ? 1 : null,
              },
            ],
      );
    }
    if (text.includes('FROM "teamMember"'))
      return Promise.resolve(
        options.unreadable || changed === 'unreadable'
          ? []
          : [{ teamId: 'team-1' }],
      );
    if (text.includes('FROM "member"')) {
      return Promise.resolve([
        {
          id: 'member-1',
          organizationId: 'org-1',
          userId: 'user-1',
          role:
            changed === 'disabled' ? 'disabled' : (options.role ?? 'member'),
        },
        ...(options.ambiguous
          ? [{ organizationId: 'org-2', role: 'member' }]
          : []),
      ]);
    }
    if (text.includes('INSERT INTO app.rate_limits'))
      return Promise.resolve([{ value: '1' }]);
    if (text.startsWith('INSERT INTO app.threads'))
      return Promise.resolve([{ id: 't-new' }]);
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => ({ unsafe: text }),
    async begin(
      optionsOrCallback: string | ((tx: unknown) => Promise<unknown>),
      callback?: (tx: unknown) => Promise<unknown>,
    ) {
      const run =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      if (run === undefined) throw new Error('Missing transaction callback');
      transaction = true;
      try {
        return await run(sql);
      } finally {
        transaction = false;
      }
    },
  }) as unknown as Sql;
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('organizationId', 'org-1');
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('role', options.role ?? 'member');
    c.set('orgSlug', 'acme');
    c.set('orgExplicit', !options.ambiguous);
    c.set('clientIp', '127.0.0.1');
    return next();
  });
  app.route('/', createThreadRestRoutes({ sql }));
  return { app, sql, queries };
}

const send = (app: Hono<RestEnv>, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const message = {
  content: 'Hello',
  model: 'model-a',
  providerSlug: 'provider-a',
};

beforeEach(() => {
  vi.mocked(addJobInTx).mockClear();
});

describe('REST thread paths enforce project scope', () => {
  it('lists only unfiled personal threads through the flat collection', async () => {
    const { app } = mount();
    const response = await app.request('/threads');
    expect(response.status).toBe(200);
    expect(
      (await response.json()).page.map((row: { id: string }) => row.id).sort(),
    ).toEqual(['t-archived', 't-personal', 't-sandbox']);
  });

  it('paginates only owned visible threads in the named project', async () => {
    const { app } = mount();
    const first = await app.request('/projects/p-a/threads?limit=1');
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      page: [{ id: 't-a' }],
      isDone: false,
      continueCursor: '30:t-a',
    });
    const second = await app.request(
      '/projects/p-a/threads?limit=1&cursor=30:t-a',
    );
    expect(await second.json()).toMatchObject({
      page: [{ id: 't-a-older' }],
      isDone: true,
      continueCursor: '',
    });
  });

  it.each([
    '/threads/t-a',
    '/projects/p-b/threads/t-a',
    '/projects/p-a/threads/t-personal',
    '/projects/p-a/threads/t-other-user',
    '/projects/p-a/threads/t-other-org',
    '/projects/p-a/threads/t-trash',
  ])('treats %s and all its subordinate resources as absent', async (path) => {
    const { app, queries } = mount();
    for (const suffix of ['', '/messages', '/generation']) {
      const response = await app.request(`${path}${suffix}`);
      expect(response.status).toBe(404);
    }
    expect((await send(app, `${path}/messages`, message)).status).toBe(404);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(
      queries.some(
        (query) =>
          query.text.includes('FROM app.messages') ||
          query.text.includes('FROM app.generations'),
      ),
    ).toBe(false);
  });

  it('lets an ordinary member create a direct thread in a readable project', async () => {
    const { app, queries } = mount({ role: 'member' });
    const response = await send(app, '/projects/p-a/threads', {
      title: 'Project chat',
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 't-new' });
    const metadata = queries.find((query) =>
      query.text.startsWith('INSERT INTO app.thread_metadata'),
    );
    expect(metadata?.values).toContain('p-a');
    expect(metadata?.values).toContain('direct');
  });

  it.each([
    ['archived', 403],
    ['missing', 404],
    ['foreign', 404],
    ['unreadable', 404],
    ['disabled', 404],
  ] as const)(
    'refuses a project that becomes %s between preflight and thread insertion',
    async (changedAtInsert, status) => {
      const { app, queries } = mount({ changedAtInsert });
      const response = await send(app, '/projects/p-a/threads', {
        title: 'Project chat',
      });
      expect(response.status).toBe(status);
      expect(
        queries.some((query) =>
          query.text.startsWith('INSERT INTO app.thread'),
        ),
      ).toBe(false);
    },
  );

  it('holds the active project and refreshes member access in the thread insertion transaction', async () => {
    const { app, queries } = mount();
    expect((await send(app, '/projects/p-a/threads')).status).toBe(201);
    const lock = queries.find(
      (query) =>
        query.text.includes('FROM app.projects') &&
        query.text.includes('FOR SHARE'),
    );
    expect(lock?.transaction).toBe(true);
    expect(lock?.values).toContain('p-a');
    expect(lock?.values).toContain('org-1');
    expect(
      queries.some(
        (query) => query.transaction && query.text.includes('FROM "member"'),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.transaction && query.text.includes('FROM "teamMember"'),
      ),
    ).toBe(true);
    for (const query of queries.filter((statement) =>
      statement.text.startsWith('INSERT INTO app.thread'),
    )) {
      expect(query.transaction).toBe(true);
    }
  });

  it('pins the accepted project and returns its generation URL for member sends', async () => {
    const { app, sql } = mount();
    const response = await send(
      app,
      '/projects/p-a/threads/t-a/messages',
      message,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      threadId: 't-a',
      status: 'accepted',
      model: 'model-a',
      poll: '/api/v1/projects/p-a/threads/t-a/generation',
    });
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({
        threadId: 't-a',
        expectedProjectId: 'p-a',
        modelId: 'model-a',
        providerSlug: 'provider-a',
      }),
    );
    const poll = await app.request('/projects/p-a/threads/t-a/generation');
    expect(await poll.json()).toEqual({ status: 'idle' });
  });

  it('pins an unfiled send to null project scope', async () => {
    const { app } = mount();
    const response = await send(app, '/threads/t-personal/messages', message);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      poll: '/api/v1/threads/t-personal/generation',
    });
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'chat.api_turn',
      expect.objectContaining({ expectedProjectId: null }),
    );
  });

  it.each(['/threads', '/projects/p-a/threads'])(
    'refuses project scope or agent selectors in the %s body',
    async (path) => {
      const { app, queries } = mount();
      for (const field of [
        'projectId',
        'agentSlug',
        'agentId',
        'projectAgentId',
      ]) {
        expect((await send(app, path, { [field]: 'p-a' })).status).toBe(400);
      }
      expect(
        queries.some((query) =>
          query.text.startsWith('INSERT INTO app.threads'),
        ),
      ).toBe(false);
    },
  );

  it.each([
    '/threads/t-personal/messages',
    '/projects/p-a/threads/t-a/messages',
  ])('refuses payload projectId on %s', async (path) => {
    const { app } = mount();
    expect(
      (await send(app, path, { ...message, projectId: 'p-a' })).status,
    ).toBe(400);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([
    { unreadable: true },
    { absentProject: true },
    { foreignProject: true },
  ])('hides unavailable projects for %j', async (options) => {
    const { app } = mount(options);
    expect((await app.request('/projects/p-a/threads')).status).toBe(404);
    expect(
      (await app.request('/projects/p-a/threads/t-a/messages')).status,
    ).toBe(404);
    expect((await send(app, '/projects/p-a/threads', {})).status).toBe(404);
    expect(
      (await send(app, '/projects/p-a/threads/t-a/messages', message)).status,
    ).toBe(404);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('requires explicit org selection on project reads by multi-org keys', async () => {
    const { app } = mount({ ambiguous: true });
    expect((await app.request('/projects/p-a/threads')).status).toBe(400);
    expect((await app.request('/projects/p-a/threads/t-a')).status).toBe(400);
  });

  it('reads archived projects but cannot create or send into them', async () => {
    const { app } = mount({ archivedProject: true });
    expect((await app.request('/projects/p-a/threads/t-a')).status).toBe(200);
    expect((await send(app, '/projects/p-a/threads', {})).status).toBe(403);
    expect(
      (await send(app, '/projects/p-a/threads/t-a/messages', message)).status,
    ).toBe(403);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each(['t-archived', 't-sandbox'])(
    'keeps %s readable but refuses messages',
    async (threadId) => {
      const { app } = mount();
      expect((await app.request(`/threads/${threadId}`)).status).toBe(200);
      expect(
        (await send(app, `/threads/${threadId}/messages`, message)).status,
      ).toBe(409);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it.each(['2.5', '2147483648', '-1', '1e100'])(
    'does not pass malformed message cursor %s into an int cast',
    async (cursor) => {
      const { app, queries } = mount();
      expect(
        (await app.request(`/threads/t-personal/messages?cursor=${cursor}`))
          .status,
      ).toBe(200);
      const query = queries.find((entry) =>
        entry.text.includes('FROM app.messages'),
      );
      expect(query?.values).toEqual(['t-personal', null, null, 26]);
    },
  );
});
