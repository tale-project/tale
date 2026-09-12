// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listComposerModels } from '../domains/chat/composer.ts';
import {
  renameThread,
  setThreadArchived,
  trashThread,
} from '../domains/chat/threads.ts';
import { resolveModelGovernanceForUser } from '../domains/governance/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import type { RestEnv } from './shared.ts';
import { createThreadRestRoutes } from './v1-threads.ts';

vi.mock('../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../domains/chat/composer.ts', () => ({
  listComposerModels: vi.fn(),
}));
vi.mock('../domains/governance/service.ts', () => ({
  resolveModelGovernanceForUser: vi.fn(() =>
    Promise.resolve({ accessibleModelRefs: [] }),
  ),
}));
vi.mock('../domains/chat/threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/chat/threads.ts')>()),
  renameThread: vi.fn(() => Promise.resolve(true)),
  setThreadArchived: vi.fn(() => Promise.resolve(true)),
  trashThread: vi.fn(() => Promise.resolve(true)),
}));

/** What `GET /models` advertises in these tests: one direct pair, plus a
 * subscription model the REST door hides because it only runs in a sandbox. */
function catalog() {
  vi.mocked(listComposerModels).mockResolvedValue({
    models: [
      {
        id: 'model-a',
        label: 'Model A',
        providerSlug: 'provider-a',
        providerLabel: 'Provider A',
        credential: { authMethod: 'api-key' },
        tools: true,
        contextWindow: 128_000,
        tags: ['chat'],
      },
      {
        id: 'sandbox-model',
        label: 'Sandbox model',
        providerSlug: 'subscription',
        providerLabel: 'Subscription',
        credential: {
          authMethod: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'claude-code' },
        },
        tools: true,
        contextWindow: 128_000,
        tags: ['chat'],
      },
      // The same id from a second direct provider — a send naming only
      // the model must ask the caller which one.
      {
        id: 'shared-model',
        label: 'Shared model',
        providerSlug: 'provider-a',
        providerLabel: 'Provider A',
        credential: { authMethod: 'api-key' },
        tools: true,
        contextWindow: 128_000,
        tags: ['chat'],
      },
      {
        id: 'shared-model',
        label: 'Shared model',
        providerSlug: 'provider-b',
        providerLabel: 'Provider B',
        credential: { authMethod: 'env' },
        tools: true,
        contextWindow: 128_000,
        tags: ['chat'],
      },
    ],
    harnesses: [],
    voice: { ttsAvailable: false, transcriptionAvailable: false },
  });
}

interface Captured {
  text: string;
  values: unknown[];
}

const thread = {
  id: 't-1',
  title: 'Refunds',
  kind: 'direct',
  harness: null,
  projectId: null,
  archived: false,
  archivedAt: null,
  isShared: null,
  generating: false,
  queuedSince: null,
  streamId: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

/** Tagged-template Sql double: the caller's thread for the loader, an
 * unspent limiter, empty elsewhere; records every query. `begin` runs the
 * callback on the same tag, so a domain transaction is captured like a plain
 * query. */
function fakeSql(
  options: {
    generating?: boolean;
    /** The accepted send waits for a worker: the 202's marker is set. */
    queued?: boolean;
    archived?: boolean;
    messages?: Record<string, unknown>[];
  } = {},
): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.threads t') && text.includes('t.id = $?')) {
      return Promise.resolve([
        {
          ...thread,
          ...(options.queued
            ? { queuedSince: 1_700_000_000_005, streamId: 'm-pre' }
            : {}),
          ...(options.archived
            ? { archived: true, archivedAt: 1_700_000_000_009 }
            : {}),
        },
      ]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.startsWith('INSERT INTO app.threads')) {
      return Promise.resolve([{ id: 't-new' }]);
    }
    if (text.startsWith('UPDATE app.generations SET cancel_requested')) {
      return Promise.resolve(
        options.generating ? [{ messageId: 'm-pending' }] : [],
      );
    }
    if (text.includes('FROM app.generations WHERE thread_id')) {
      return Promise.resolve(
        options.generating ? [{ threadId: 't-1', messageId: 'm-pending' }] : [],
      );
    }
    if (text.includes('FROM app.messages WHERE thread_id')) {
      return Promise.resolve(
        options.messages ?? [
          {
            id: 'm-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Hi' }],
            text: 'Hi',
            sequence: 1,
            stepOrder: 0,
            model: 'model-a',
            providerSlug: 'provider-a',
            blockedReason: null,
            error: null,
            status: 'complete',
            usage: {
              inputTokens: 12,
              outputTokens: 3,
              costEstimateCents: 0.042,
              provider: 'raw-not-for-the-wire',
            },
            createdAt: 1_700_000_000_002,
          },
        ],
      );
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(sql: Sql) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createThreadRestRoutes({ sql }));
  return app;
}

/**
 * GET …/messages bounds its page through the shared `pageLimit`. The
 * regression under test: the route clamped without truncating, so
 * `?limit=2.5` shipped to Postgres as `3.5` and `int8in` refused it — a
 * 500 for a malformed query string.
 */
describe('GET /threads/{id}/messages limit', () => {
  it('refuses a limit that is not a number, and a cursor that is not a message order', async () => {
    const { sql } = fakeSql();
    const limit = await mount(sql).request(
      'http://localhost/threads/t-1/messages?limit=abc',
    );
    expect(limit.status).toBe(400);
    expect(await limit.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    const cursor = await mount(sql).request(
      'http://localhost/threads/t-1/messages?cursor=not-a-number',
    );
    expect(cursor.status).toBe(400);
    expect(await cursor.json()).toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it.each([
    ['-4', 2],
    ['999', 101],
  ])(
    'clamps ?limit=%s into a whole LIMIT of %i (page + 1)',
    async (limit, expected) => {
      const { sql, queries } = fakeSql();
      const res = await mount(sql).request(
        `http://localhost/threads/t-1/messages?limit=${limit}`,
      );
      expect(res.status).toBe(200);
      const page = queries.find((q) => q.text.includes('FROM app.messages'));
      expect(page?.values).toContain(expected);
    },
  );

  it('refuses a fractional limit and a parameter the route does not take', async () => {
    const { sql, queries } = fakeSql();
    const fraction = await mount(sql).request(
      'http://localhost/threads/t-1/messages?limit=2.5',
    );
    expect(fraction.status).toBe(400);
    expect(await fraction.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    const stray = await mount(sql).request(
      'http://localhost/threads/t-1/messages?before=12',
    );
    expect(stray.status).toBe(400);
    expect(await stray.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'before' }] },
    });
    expect(queries.some((q) => q.text.includes('FROM app.messages'))).toBe(
      false,
    );
  });
});

describe('POST /threads/{id}/messages body', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
    vi.mocked(listComposerModels).mockReset();
    catalog();
  });

  it('forwards the chosen model provider to the background turn', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          model: 'model-a',
          providerSlug: 'provider-a',
        }),
      },
    );
    expect(res.status).toBe(202);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({
        modelId: 'model-a',
        providerSlug: 'provider-a',
        // A choice, not a hint: the turn must not fall back to another
        // connector if the configuration changes before it runs.
        providerStrict: true,
      }),
    );
  });
  it('answers 400 in the JSON envelope for a malformed body', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO app.messages')),
    ).toBe(false);
  });
});

/**
 * An explicit `providerSlug` is a choice. The turn's own resolution treats
 * an unmatched provider as a hint and falls back to whichever connector
 * serves the model id — so a machine caller that sent a typo got a reply
 * from a provider it never named, with nothing in the 202 saying so. The
 * door now holds the pair to what `GET /models` advertises.
 */
describe('POST /threads/{id}/messages provider choice', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
    vi.mocked(listComposerModels).mockReset();
    catalog();
  });

  const send = (sql: Sql, body: Record<string, unknown>) =>
    mount(sql).request('http://localhost/threads/t-1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', ...body }),
    });

  it('refuses a provider the model list does not carry, and queues nothing', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, {
      model: 'model-a',
      providerSlug: 'tale-eval-nonexistent-provider',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('Unknown provider'),
      code: 'CHAT_PROVIDER_UNKNOWN',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refuses a listed provider that does not serve the chosen model', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, {
      model: 'model-b',
      providerSlug: 'provider-a',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('does not serve model "model-b"'),
      code: 'CHAT_MODEL_NOT_ON_PROVIDER',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('holds the caller to the REST projection — a sandbox-only provider is unknown here', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, {
      model: 'sandbox-model',
      providerSlug: 'subscription',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'CHAT_PROVIDER_UNKNOWN' });
  });

  /**
   * Without a provider the model is resolved HERE against the same listing:
   * an unknown model used to be a 202 whose turn failed minutes later as an
   * assistant error row — the caller learned of a typo through the message
   * channel, after a burnt execute slot.
   */
  it('resolves the provider for a model named alone, names it in the 202, and pins it', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, { model: 'model-a' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      model: 'model-a',
      providerSlug: 'provider-a',
    });
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({
        modelId: 'model-a',
        providerSlug: 'provider-a',
        providerStrict: true,
      }),
    );
  });

  it('refuses a model the listing does not carry before anything is queued', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, { model: 'gpt-4o-mini' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('Unknown model "gpt-4o-mini"'),
      code: 'CHAT_MODEL_UNKNOWN',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('holds a model served by two providers until the caller names one', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, { model: 'shared-model' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('providerSlug'),
      code: 'CHAT_MODEL_AMBIGUOUS',
      data: { providers: ['provider-a', 'provider-b'] },
    });
    expect(addJobInTx).not.toHaveBeenCalled();
    const named = await send(sql, {
      model: 'shared-model',
      providerSlug: 'provider-b',
    });
    expect(named.status).toBe(202);
  });

  it('refuses a blank prompt and a locale that is not a language tag', async () => {
    const { sql } = fakeSql();
    const blank = await send(sql, { content: '   \n\t', model: 'model-a' });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ code: 'INVALID_BODY' });
    const locale = await send(sql, { model: 'model-a', locale: 'not a tag!' });
    expect(locale.status).toBe(400);
    expect(await locale.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: {
        issues: [
          {
            path: 'locale',
            message: expect.stringContaining('BCP 47'),
          },
        ],
      },
    });
    expect(addJobInTx).not.toHaveBeenCalled();
    const tagged = await send(sql, { model: 'model-a', locale: 'de-CH' });
    expect(tagged.status).toBe(202);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({ locale: 'de-CH', userText: 'Hello' }),
    );
  });
});

describe('GET /models', () => {
  beforeEach(() => {
    vi.mocked(listComposerModels).mockReset();
    vi.mocked(resolveModelGovernanceForUser).mockReset();
    catalog();
  });

  it('carries what a client needs to choose, and marks the organization default', async () => {
    vi.mocked(resolveModelGovernanceForUser).mockResolvedValue({
      defaultModel: { providerName: 'provider-b', modelId: 'shared-model' },
      accessibleModelRefs: [],
    });
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/models');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Record<string, unknown>[] };
    expect(body.models.map((model) => model.id)).toEqual([
      'model-a',
      'shared-model',
      'shared-model',
    ]);
    expect(body.models[0]).toEqual({
      id: 'model-a',
      label: 'Model A',
      providerSlug: 'provider-a',
      providerLabel: 'Provider A',
      contextWindow: 128_000,
      capabilities: { tools: true, vision: false, reasoning: false },
      tags: ['chat'],
    });
    expect(body.models[1]).not.toHaveProperty('default');
    expect(body.models[2]).toMatchObject({
      providerSlug: 'provider-b',
      default: true,
    });
    expect(resolveModelGovernanceForUser).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      supportedModels: ['model-a', 'shared-model'],
    });
  });
});

describe('GET /threads/{id}/messages', () => {
  it('carries the row status and the whitelisted token usage, cost estimate included', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: Record<string, unknown>[] };
    expect(body.page[0]).toMatchObject({
      status: 'complete',
      usage: { inputTokens: 12, outputTokens: 3, costEstimateCents: 0.042 },
    });
    expect(body.page[0]?.usage).not.toHaveProperty('provider');
  });

  it('omits usage the row never recorded', async () => {
    const { sql } = fakeSql({
      messages: [
        {
          id: 'm-2',
          role: 'assistant',
          parts: [],
          text: null,
          sequence: 2,
          stepOrder: 0,
          model: 'model-a',
          providerSlug: null,
          blockedReason: null,
          error: null,
          status: 'pending',
          usage: null,
          createdAt: 1_700_000_000_003,
        },
      ],
    });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
    );
    const body = (await res.json()) as { page: Record<string, unknown>[] };
    expect(body.page[0]).toMatchObject({ status: 'pending' });
    expect(body.page[0]).not.toHaveProperty('usage');
  });
});

/**
 * The thread lifecycle a REST integration needs: archive a thread out of
 * the way, delete one it created, stop a turn — each the app's own move,
 * reached through the same visibility gate as every read.
 */
describe('thread lifecycle', () => {
  beforeEach(() => {
    vi.mocked(renameThread).mockClear();
    vi.mocked(setThreadArchived).mockClear();
    vi.mocked(trashThread).mockClear();
  });

  it('PATCH renames the thread, and carries archivedAt on an archived one', async () => {
    const { sql } = fakeSql({ archived: true });
    const res = await mount(sql).request('http://localhost/threads/t-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Q3 review ' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 't-1',
      title: 'Q3 review',
      archived: true,
      archivedAt: 1_700_000_000_009,
    });
    expect(renameThread).toHaveBeenCalledWith(
      sql,
      'org-1',
      'user-1',
      't-1',
      'Q3 review',
    );
    expect(setThreadArchived).not.toHaveBeenCalled();
  });

  it('PATCH refuses a field it does not take, and an empty patch', async () => {
    const { sql } = fakeSql();
    for (const body of [{ pinned: true }, {}]) {
      const res = await mount(sql).request('http://localhost/threads/t-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    }
    expect(setThreadArchived).not.toHaveBeenCalled();
    expect(renameThread).not.toHaveBeenCalled();
  });

  it('PATCH archives the thread through the audited toggle', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads/t-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 't-1', archived: true });
    expect(setThreadArchived).toHaveBeenCalledWith(
      sql,
      { organizationId: 'org-1', userId: 'user-1', email: 'user@example.com' },
      't-1',
      true,
    );
  });

  it('DELETE trashes the thread, and refuses one mid-turn', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads/t-1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(trashThread).toHaveBeenCalledWith(
      sql,
      { organizationId: 'org-1', userId: 'user-1', email: 'user@example.com' },
      't-1',
    );

    const busy = fakeSql({ generating: true });
    const refused = await mount(busy.sql).request(
      'http://localhost/threads/t-1',
      { method: 'DELETE' },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: 'CHAT_TURN_IN_PROGRESS',
    });
    expect(trashThread).toHaveBeenCalledTimes(1);
  });

  it('DELETE …/generation asks the running turn to stop, and is a 404 when idle', async () => {
    const busy = fakeSql({ generating: true });
    const res = await mount(busy.sql).request(
      'http://localhost/threads/t-1/generation',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      status: 'cancelling',
      messageId: 'm-pending',
    });
    expect(
      busy.queries.some((q) =>
        q.text.startsWith('UPDATE app.generations SET cancel_requested = true'),
      ),
    ).toBe(true);

    const idle = fakeSql();
    const none = await mount(idle.sql).request(
      'http://localhost/threads/t-1/generation',
      { method: 'DELETE' },
    );
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({ code: 'CHAT_TURN_NOT_RUNNING' });
  });
});

describe('POST /threads uses the built-in assistant', () => {
  it.each(['agentSlug', 'agentId', 'projectAgentId'])(
    'rejects an unsupported %s selector before creating a thread',
    async (selector) => {
      const { sql, queries } = fakeSql();
      const response = await mount(sql).request('http://localhost/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Refunds', [selector]: 'reviewer' }),
      });
      expect(response.status).toBe(400);
      expect(
        queries.some((query) =>
          query.text.startsWith('INSERT INTO app.threads'),
        ),
      ).toBe(false);
    },
  );

  it('creates a direct thread with no selector', async () => {
    const { sql } = fakeSql();
    const response = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Refunds' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 't-new' });
  });
});

/**
 * The 202 names the reply before the turn exists, and the poll tells the
 * truth in between: a caller that lost the 202 used to see `idle` (the
 * generation row did not exist yet) and stop waiting; a caller that kept
 * it had no id to find its reply by. The send also takes the effort pick
 * and a reply ceiling, checked against the listed model's own.
 */
describe('POST …/messages — the 202 names the reply and bounds the turn', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
    catalog();
  });

  it('names the pre-minted assistant message and sets the queued marker with the job', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', model: 'model-a' }),
      },
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { messageId: string };
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({ assistantMessageId: body.messageId }),
    );
    const marker = queries.find((q) =>
      q.text.startsWith(
        'UPDATE app.thread_metadata SET generation_queued_since_ms',
      ),
    );
    expect(marker?.values).toContain(body.messageId);
  });

  it('forwards the effort pick and the reply ceiling to the turn', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          model: 'model-a',
          reasoningEffort: 'high',
          maxOutputTokens: 300,
        }),
      },
    );
    expect(res.status).toBe(202);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({
        reasoningEffort: 'high',
        maxOutputTokens: 300,
      }),
    );
  });

  it('refuses a ceiling above the listed model’s own, naming it, and an unknown effort', async () => {
    vi.mocked(listComposerModels).mockResolvedValue({
      models: [
        {
          id: 'model-a',
          label: 'Model A',
          providerSlug: 'provider-a',
          providerLabel: 'Provider A',
          credential: { authMethod: 'api-key' },
          tools: true,
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          tags: ['chat'],
        },
      ],
      harnesses: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    } as never);
    const { sql } = fakeSql();
    const over = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          model: 'model-a',
          maxOutputTokens: 5_000,
        }),
      },
    );
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [{ path: 'maxOutputTokens' }] },
    });
    expect(addJobInTx).not.toHaveBeenCalled();
    const atCap = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          model: 'model-a',
          maxOutputTokens: 4_096,
        }),
      },
    );
    expect(atCap.status).toBe(202);
    const effort = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          model: 'model-a',
          reasoningEffort: 'ultra',
        }),
      },
    );
    expect(effort.status).toBe(400);
    expect(await effort.json()).toMatchObject({
      data: { issues: [{ path: 'reasoningEffort' }] },
    });
  });

  it('tells a caller that sent no model where the models are listed', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: {
        issues: [
          {
            path: 'model',
            message: expect.stringContaining('GET /api/v1/models'),
          },
        ],
      },
    });
  });
});

describe('GET …/generation — queued, streaming with progress, idle', () => {
  it('answers queued with the promised id while the accepted send waits for a worker', async () => {
    const { sql } = fakeSql({ queued: true });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'queued', messageId: 'm-pre' });
  });

  it('carries the text streamed so far and the cancel flag while streaming', async () => {
    const { sql } = fakeSql({ generating: true });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'streaming',
      messageId: 'm-pending',
      text: '',
      reasoning: '',
      cancelRequested: false,
    });
  });

  it('is idle once neither the marker nor the generation row exists', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(await res.json()).toEqual({ status: 'idle' });
  });

  it('DELETE stamps the stop on the thread beside the cancel flag', async () => {
    const { sql, queries } = fakeSql({ generating: true });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/generation',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(202);
    const stamp = queries.find((q) =>
      q.text.startsWith('UPDATE app.thread_metadata SET cancelled_at_ms'),
    );
    expect(stamp?.values).toContain('m-pending');
  });
});

describe('thread reads — one join, no query per row', () => {
  it('lists threads without a generation lookup per row', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads');
    expect(res.status).toBe(200);
    expect(
      queries.some((q) =>
        q.text.includes('FROM app.generations WHERE thread_id'),
      ),
    ).toBe(false);
    // The joins ride an `unsafe` fragment, which the double records as a
    // bound value.
    const list = queries.find((q) => q.text.includes('FROM app.threads t'));
    expect(
      list?.values.some(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'unsafe' in value &&
          String(value.unsafe).includes('LEFT JOIN app.generations g'),
      ),
    ).toBe(true);
  });

  it('carries archivedAt on an archived thread', async () => {
    const { sql } = fakeSql({ archived: true });
    const res = await mount(sql).request('http://localhost/threads/t-1');
    expect(await res.json()).toMatchObject({
      archived: true,
      archivedAt: 1_700_000_000_009,
      generating: false,
    });
  });
});
