// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeChatError } from '../../lib/shared/chat-errors.ts';
import { listComposerModels } from '../domains/chat/composer.ts';
import type { RestEnv } from './shared.ts';
import { createThreadRestRoutes } from './v1-threads.ts';

/**
 * The threads door's contract details. The regressions under test:
 *
 * - `POST /threads` took a broken JSON body for an empty one and created a
 *   thread.
 * - `GET …/messages` shipped a failed turn's `error` as the app's stored
 *   envelope — `TALE_ERR1 %7B…%7D` and the sentence after a newline — so a
 *   REST client read an internal header instead of what went wrong.
 */

vi.mock('../domains/chat/composer.ts', () => ({
  listComposerModels: vi.fn(),
}));

const thread = {
  id: 't-1',
  title: 'Refunds',
  kind: 'direct',
  harness: null,
  projectId: null,
  archived: false,
  isShared: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

const failedTurn = encodeChatError({
  code: 'model_not_found',
  model: 'acme/nope',
  raw: 'No model "acme/nope" is available in this organization.',
});

function fakeSql(storedError = failedTurn): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('FROM app.threads t') && text.includes('t.id = $?')) {
      return Promise.resolve([thread]);
    }
    if (text.includes('FROM app.messages WHERE thread_id')) {
      return Promise.resolve([
        {
          id: 'm-1',
          role: 'assistant',
          parts: [],
          text: null,
          sequence: 1,
          stepOrder: 0,
          model: 'acme/nope',
          providerSlug: null,
          blockedReason: null,
          error: storedError,
          createdAt: 1_700_000_000_002,
        },
      ]);
    }
    if (text.startsWith('INSERT INTO app.threads')) {
      return Promise.resolve([{ id: 't-new' }]);
    }
    return Promise.resolve([]);
  };
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe: (t: string) => t, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(storedError = failedTurn) {
  const fake = fakeSql(storedError);
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
  app.route('/', createThreadRestRoutes({ sql: fake.sql }));
  return { app, queries: fake.queries };
}

const post = (body: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});

beforeEach(() => {
  vi.mocked(listComposerModels).mockReset();
});

describe('GET /models', () => {
  it('uses the key holder and org to list accessible models without credential details', async () => {
    vi.mocked(listComposerModels).mockResolvedValue({
      models: [
        {
          id: 'model-a',
          label: 'Model A',
          providerSlug: 'provider-a',
          providerLabel: 'Provider A',
          credential: { authMethod: 'api-key' },
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
        },
      ],
      harnesses: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    });
    const { app } = mount();
    const res = await app.request('http://localhost/models');
    expect(res.status).toBe(200);
    expect(listComposerModels).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'user-1',
    });
    expect(await res.json()).toEqual({
      models: [
        {
          id: 'model-a',
          label: 'Model A',
          providerSlug: 'provider-a',
          providerLabel: 'Provider A',
        },
      ],
    });
  });

  it('returns an empty list when no model is available', async () => {
    vi.mocked(listComposerModels).mockResolvedValue({
      models: [],
      harnesses: [],
      voice: { ttsAvailable: false, transcriptionAvailable: false },
    });
    const { app } = mount();
    const res = await app.request('http://localhost/models');
    expect(await res.json()).toEqual({ models: [] });
  });
});

describe('POST /threads', () => {
  it('answers 400 for a body that is present but not JSON, and creates nothing', async () => {
    const { app, queries } = mount();
    const res = await app.request(
      'http://localhost/threads',
      post('{"title": '),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid body: The body is not valid JSON',
      code: 'INVALID_BODY',
    });
    expect(queries.some((q) => q.startsWith('INSERT INTO app.threads'))).toBe(
      false,
    );
  });
});

describe('GET /threads/{id}/messages error field', () => {
  it.each([
    [encodeChatError({ code: 'generic' }), 'The turn failed.'],
    ['Legacy provider failure', 'Legacy provider failure'],
  ])('keeps a readable fallback for %s', async (stored, expected) => {
    const { app } = mount(stored);
    const response = await app.request('http://localhost/threads/t-1/messages');
    const body = (await response.json()) as { page: { error: string }[] };
    expect(body.page[0]?.error).toBe(expected);
  });
  it('carries the failure sentence and its code, never the stored envelope', async () => {
    const { app } = mount();
    const res = await app.request('http://localhost/threads/t-1/messages');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: Record<string, unknown>[] };
    expect(body.page[0]).toMatchObject({
      error: 'No model "acme/nope" is available in this organization.',
      errorCode: 'model_not_found',
    });
    expect(String(body.page[0]?.error)).not.toContain('TALE_ERR1');
  });
});
