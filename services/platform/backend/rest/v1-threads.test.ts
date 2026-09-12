// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listComposerModels } from '../domains/chat/composer.ts';
import { sendIdempotencyRequestHash } from '../domains/chat/send-idempotency.ts';
import {
  renameThread,
  setThreadArchived,
  trashThread,
} from '../domains/chat/threads.ts';
import { resolveModelGovernanceForUser } from '../domains/governance/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import { mintCursorFor, type RestEnv } from './shared.ts';
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
    /** The text the generation row holds while streaming. */
    generationText?: string;
    messages?: Record<string, unknown>[];
    /** A live ledger row an earlier keyed send committed — the claim finds
     * it and reads it back. */
    remembered?: { requestHash: string; response: Record<string, unknown> };
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
          // The loader's one join: the generation row's existence IS the
          // `generating` flag every gate reads.
          ...(options.generating
            ? { generating: true, streamId: 'm-pending' }
            : {}),
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
    // The send's claim: the conditional marker write lands only while no
    // send is queued and no turn is running — the row lock's verdict, as
    // the real schema answers it.
    if (
      text.startsWith(
        'UPDATE app.thread_metadata SET generation_queued_since_ms',
      )
    ) {
      return Promise.resolve(
        options.generating || options.queued ? [] : [{ threadId: 't-1' }],
      );
    }
    if (text.includes('FROM app.generations WHERE thread_id')) {
      return Promise.resolve(
        options.generating
          ? [
              {
                threadId: 't-1',
                messageId: 'm-pending',
                ...(options.generationText !== undefined
                  ? { text: options.generationText }
                  : {}),
              },
            ]
          : [],
      );
    }
    if (text.startsWith('INSERT INTO app.chat_send_idempotency')) {
      return Promise.resolve(
        options.remembered === undefined ? [{ scopeKey: 'k' }] : [],
      );
    }
    if (text.startsWith('SELECT request_hash AS "requestHash", response')) {
      return Promise.resolve(
        options.remembered === undefined ? [] : [options.remembered],
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
  const json = (value: unknown) => ({ json: value });
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, json, begin });
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

  it('lifts the finish reason to the message and whitelists the two usage flags', async () => {
    const { sql } = fakeSql({
      messages: [
        {
          id: 'm-3',
          role: 'assistant',
          parts: [{ type: 'text', text: '1\n2\n3' }],
          text: '1\n2\n3',
          sequence: 3,
          stepOrder: 0,
          model: 'model-a',
          providerSlug: 'provider-a',
          blockedReason: null,
          error: null,
          status: 'complete',
          usage: {
            inputTokens: 2711,
            outputTokens: 64,
            costEstimateCents: 0.0397,
            finishReason: 'length',
            estimated: true,
            stepLimitHit: true,
            durationMs: 1234,
          },
          createdAt: 1_700_000_000_004,
        },
      ],
    });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
    );
    const body = (await res.json()) as { page: Record<string, unknown>[] };
    expect(body.page[0]).toMatchObject({
      status: 'complete',
      finishReason: 'length',
      usage: {
        inputTokens: 2711,
        outputTokens: 64,
        costEstimateCents: 0.0397,
        estimated: true,
        stepLimitHit: true,
      },
    });
    expect(body.page[0]?.usage).not.toHaveProperty('finishReason');
    expect(body.page[0]?.usage).not.toHaveProperty('durationMs');
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

  it('DELETE refuses a thread whose accepted send is still queued', async () => {
    // The 202 was answered and the worker has not opened the turn: the
    // job would otherwise open a turn on a trashed thread.
    const queued = fakeSql({ queued: true });
    const refused = await mount(queued.sql).request(
      'http://localhost/threads/t-1',
      { method: 'DELETE' },
    );
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: 'CHAT_TURN_IN_PROGRESS',
    });
    expect(trashThread).not.toHaveBeenCalled();
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

  /**
   * One title bound for the whole lifecycle: create accepted 200
   * characters, untrimmed, while PATCH and the assistant's own naming
   * held 120 — so a read-modify-write of a title the API itself minted
   * was refused. Create now trims and caps like the rename does.
   */
  it('trims the title and holds it to the rename bound', async () => {
    const { sql, queries } = fakeSql();
    const padded = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Q3 review ' }),
    });
    expect(padded.status).toBe(201);
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.threads'),
    );
    expect(insert?.values).toContain('Q3 review');
    expect(insert?.values).not.toContain('  Q3 review ');

    for (const title of ['L'.repeat(121), '   \n\t']) {
      const refused = await mount(sql).request('http://localhost/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        code: 'INVALID_BODY',
        data: { issues: [{ path: 'title' }] },
      });
    }
    const atCap = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'L'.repeat(120) }),
    });
    expect(atCap.status).toBe(201);
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
    // The marker write is the claim: it lands only while no send is
    // queued and no turn is running, and the row it returns is the verdict.
    expect(marker?.text).toContain('generation_queued_since_ms IS NULL');
    expect(marker?.text).toContain(
      'NOT EXISTS ( SELECT 1 FROM app.generations WHERE thread_id = $? )',
    );
    expect(marker?.text).toContain('RETURNING thread_id');
  });

  /**
   * The one-turn-per-thread rule held only against a RUNNING turn: a second
   * send while the first was still queued (accepted, no worker yet) was
   * answered 202, overwrote the first send's marker and reply id, and ran
   * a second turn — two bills, and a poll handle stolen from the first.
   */
  it('refuses a send while an accepted one is still queued, and queues nothing', async () => {
    const { sql } = fakeSql({ queued: true });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', model: 'model-a' }),
      },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This conversation is already generating a response.',
      code: 'CHAT_TURN_IN_PROGRESS',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refuses a send while a turn streams — the claim finds no row, no pre-read needed', async () => {
    const { sql, queries } = fakeSql({ generating: true });
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', model: 'model-a' }),
      },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CHAT_TURN_IN_PROGRESS' });
    expect(addJobInTx).not.toHaveBeenCalled();
    // No separate existence read: the conditional write is the whole gate.
    expect(
      queries.some((q) =>
        q.text.startsWith(
          'SELECT thread_id AS "threadId" FROM app.generations',
        ),
      ),
    ).toBe(false);
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

/**
 * The one operation on this surface that spends money had no way to be
 * retried safely: a lost 202 retried as a second POST started and billed a
 * second turn. `Idempotency-Key` names the send, exactly as it names a run
 * start — the claim lives in the accept's own transaction, before the
 * turn gate, so a refusal is never remembered.
 */
describe('POST …/messages — Idempotency-Key', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockClear();
    catalog();
  });

  const keyedSend = (
    sql: Sql,
    key: string,
    body: Record<string, unknown> = { content: 'Hello', model: 'model-a' },
  ) =>
    mount(sql).request('http://localhost/threads/t-1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });

  it('claims the key before the turn gate, and remembers the 202 with the job', async () => {
    const { sql, queries } = fakeSql();
    const res = await keyedSend(sql, 'send-1');
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('duplicate');
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    const at = (prefix: string) =>
      queries.findIndex((q) => q.text.startsWith(prefix));
    const claim = at('INSERT INTO app.chat_send_idempotency');
    const marker = at(
      'UPDATE app.thread_metadata SET generation_queued_since_ms',
    );
    const remember = at('UPDATE app.chat_send_idempotency SET message_id');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(claim).toBeLessThan(marker);
    expect(remember).toBeGreaterThan(marker);
    expect(queries[remember]?.values).toContain(body.messageId);
    expect(
      queries.some((q) =>
        q.text.startsWith('DELETE FROM app.chat_send_idempotency'),
      ),
    ).toBe(true);
  });

  it('answers the remembered 202 with duplicate: true for the same request, and queues nothing', async () => {
    const response = {
      threadId: 't-1',
      status: 'accepted',
      model: 'model-a',
      providerSlug: 'provider-a',
      messageId: 'm-first',
      poll: '/api/v1/threads/t-1/generation',
    };
    const { sql, queries } = fakeSql({
      remembered: {
        requestHash: sendIdempotencyRequestHash({
          content: 'Hello',
          model: 'model-a',
        }),
        response,
      },
    });
    const res = await keyedSend(sql, 'send-1');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ...response, duplicate: true });
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(
      queries.some((q) =>
        q.text.startsWith(
          'UPDATE app.thread_metadata SET generation_queued_since_ms',
        ),
      ),
    ).toBe(false);
  });

  it('refuses a live key reused with another body (409 IDEMPOTENCY_KEY_REUSED) and queues nothing', async () => {
    const { sql } = fakeSql({
      remembered: {
        requestHash: sendIdempotencyRequestHash({
          content: 'Something else',
          model: 'model-a',
        }),
        response: { messageId: 'm-first' },
      },
    });
    const res = await keyedSend(sql, 'send-1');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('already used for a different request'),
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('never remembers a refusal: a busy thread refuses after the claim, and the accept never lands', async () => {
    const { sql, queries } = fakeSql({ queued: true });
    const res = await keyedSend(sql, 'send-1');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CHAT_TURN_IN_PROGRESS' });
    expect(addJobInTx).not.toHaveBeenCalled();
    // The claim was taken inside the transaction the refusal rolled back;
    // the 202 that would have made the row a memory was never written.
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.chat_send_idempotency'),
      ),
    ).toBe(true);
    expect(
      queries.some((q) =>
        q.text.startsWith('UPDATE app.chat_send_idempotency SET message_id'),
      ),
    ).toBe(false);
  });

  it('reads a blank key as no key', async () => {
    const { sql, queries } = fakeSql();
    const res = await keyedSend(sql, '   ');
    expect(res.status).toBe(202);
    expect(
      queries.some((q) => q.text.includes('app.chat_send_idempotency')),
    ).toBe(false);
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
      textOffset: 0,
      textLength: 0,
      reasoning: '',
      cancelRequested: false,
    });
  });

  /**
   * The poll returned the whole reply on every call — a long answer
   * polled every two seconds was downloaded quadratically. `since` names
   * the characters the caller holds; the answer is the delta, and a reset
   * (a tool round settled the text onto the parts) answers from 0 with an
   * offset below what was sent.
   */
  it('answers the delta past ?since, from 0 when since passes the length, and refuses a non-number', async () => {
    const { sql } = fakeSql({
      generating: true,
      generationText: '1\n2\n3\n4\n',
    });
    const delta = await mount(sql).request(
      'http://localhost/threads/t-1/generation?since=4',
    );
    expect(await delta.json()).toMatchObject({
      status: 'streaming',
      text: '3\n4\n',
      textOffset: 4,
      textLength: 8,
    });
    const reset = await mount(sql).request(
      'http://localhost/threads/t-1/generation?since=500',
    );
    expect(await reset.json()).toMatchObject({
      text: '1\n2\n3\n4\n',
      textOffset: 0,
      textLength: 8,
    });
    const bad = await mount(sql).request(
      'http://localhost/threads/t-1/generation?since=-1',
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'since' }] },
    });
  });

  it('is idle once neither the marker nor the generation row exists, naming the newest assistant message', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(await res.json()).toEqual({
      status: 'idle',
      lastMessageId: 'm-1',
      lastStatus: 'complete',
    });
    // A thread nobody has written to yet: idle, and nothing to name.
    const empty = fakeSql({ messages: [] });
    const bare = await mount(empty.sql).request(
      'http://localhost/threads/t-1/generation',
    );
    expect(await bare.json()).toEqual({ status: 'idle' });
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

/**
 * The documented "poll until idle, then read the messages" recipe walked
 * the transcript oldest-first, forward-only: past 25 messages the reply
 * just paid for sat on the last page. Newest-first paging and a read by
 * id make one turn one round trip on a thread of any length.
 */
describe('GET …/messages — newest first, and one message by id', () => {
  it('pages newest first with ?order=desc, and binds the cursor to its direction', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages?order=desc',
    );
    expect(res.status).toBe(200);
    const page = queries.find((q) => q.text.includes('FROM app.messages'));
    expect(
      page?.values.some(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'unsafe' in value &&
          value.unsafe === 'DESC',
      ),
    ).toBe(true);
    const ascending = fakeSql();
    await mount(ascending.sql).request('http://localhost/threads/t-1/messages');
    const plain = ascending.queries.find((q) =>
      q.text.includes('FROM app.messages'),
    );
    expect(
      plain?.values.some(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'unsafe' in value &&
          value.unsafe === 'ASC',
      ),
    ).toBe(true);
    // A cursor minted walking oldest-first is not one the newest-first
    // walk answered.
    const crossed = await mount(sql).request(
      `http://localhost/threads/t-1/messages?order=desc&cursor=${mintCursorFor('org-1', 'messages:t-1:asc', '3')}`,
    );
    expect(crossed.status).toBe(400);
    expect(await crossed.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    const own = await mount(sql).request(
      `http://localhost/threads/t-1/messages?order=desc&cursor=${mintCursorFor('org-1', 'messages:t-1:desc', '3')}`,
    );
    expect(own.status).toBe(200);
    const unknown = await mount(sql).request(
      'http://localhost/threads/t-1/messages?order=sideways',
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'order' }] },
    });
  });

  it('reads one message by id in the list’s shape, and answers 404 MESSAGE_NOT_FOUND for a stranger', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/threads/t-1/messages/m-1',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'm-1',
      role: 'assistant',
      status: 'complete',
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    const missing = fakeSql({ messages: [] });
    const none = await mount(missing.sql).request(
      'http://localhost/threads/t-1/messages/m-nope',
    );
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({
      error: 'Message not found',
      code: 'MESSAGE_NOT_FOUND',
    });
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
