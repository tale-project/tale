/**
 * The chat REST surface, driven handler-first.
 *
 * The turn endpoint is the interesting one: it must refuse everything it CAN
 * see before it schedules anything (no such thread, a sandbox thread, a thread
 * already generating, a missing model), because once the turn is scheduled the
 * request is over and a refusal has nowhere to go. And the generation poll must
 * report an ABSENT generation row as `idle` rather than as an error — absence is
 * how a settled turn reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import {
  anonymousRequest,
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_ID,
  TEST_USER_ID,
  type StubRoutes,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import {
  createThread,
  listThreads,
  threadPostActions,
  threadReads,
} from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LIST = 'chat/rest_support:restListThreads';
const GET = 'chat/rest_support:restGetThread';
const MESSAGES = 'chat/rest_support:restListMessages';
const GENERATION = 'chat/rest_support:restGetGeneration';
const CREATE = 'chat/rest_support:restCreateThread';
const START_TURN = 'chat/turn_action:startTurnForApiKey';

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread_1',
    kind: 'direct',
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    generating: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (listThreads as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/threads'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/threads', () => {
  it('lists the threads of the key holder, not of the organization', async () => {
    const page = { page: [thread()], isDone: true, continueCursor: '' };
    const { ctx, calls } = restCtx({ [LIST]: () => page });
    const response = await (listThreads as unknown as Handler)(
      ctx,
      restRequest('/api/v1/threads?limit=5&cursor=c1'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual(page);
    expect(argsOf(calls, LIST)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      cursor: 'c1',
      limit: 5,
    });
  });
});

describe('POST /api/v1/threads', () => {
  it('creates a DIRECT thread for the key holder', async () => {
    const { ctx, calls } = restCtx({ [CREATE]: () => 'thread_new' });
    const response = await (createThread as unknown as Handler)(
      ctx,
      restRequest('/api/v1/threads', {
        method: 'POST',
        json: { title: 'Invoices', projectId: 'proj_1' },
      }),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({ id: 'thread_new' });
    expect(argsOf(calls, CREATE)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      kind: 'direct',
      title: 'Invoices',
      projectId: 'proj_1',
    });
  });

  it('accepts an empty body and refuses a non-string title', async () => {
    const { ctx } = restCtx({ [CREATE]: () => 'thread_new' });
    const bare = await (createThread as unknown as Handler)(
      ctx,
      restRequest('/api/v1/threads', { method: 'POST' }),
    );
    expect(bare.status).toBe(201);

    const bad = await (createThread as unknown as Handler)(
      ctx,
      restRequest('/api/v1/threads', { method: 'POST', json: { title: 7 } }),
    );
    expect(bad.status).toBe(400);
  });
});

describe('GET /api/v1/threads/:id/...', () => {
  const reads = threadReads as unknown as Handler;

  it('answers one thread and 404 for a thread that is not the caller-s', async () => {
    const { ctx } = restCtx({ [GET]: () => thread() });
    expect(
      (await reads(ctx, restRequest('/api/v1/threads/thread_1'))).status,
    ).toBe(200);

    const { ctx: none } = restCtx({ [GET]: () => null });
    const missing = await reads(none, restRequest('/api/v1/threads/thread_x'));
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toEqual({ error: 'Thread not found' });
  });

  it('pages the messages, and 404s when the thread is not readable', async () => {
    const { ctx, calls } = restCtx({
      [MESSAGES]: () => ({ page: [], isDone: true, continueCursor: '' }),
    });
    const response = await reads(
      ctx,
      restRequest('/api/v1/threads/thread_1/messages?limit=2'),
    );
    expect(response.status).toBe(200);
    expect(argsOf(calls, MESSAGES)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      threadId: 'thread_1',
      cursor: null,
      limit: 2,
    });

    const { ctx: none } = restCtx({ [MESSAGES]: () => null });
    expect(
      (await reads(none, restRequest('/api/v1/threads/thread_x/messages')))
        .status,
    ).toBe(404);
  });

  it('reports an absent generation row as idle', async () => {
    const { ctx } = restCtx({
      [GET]: () => thread(),
      [GENERATION]: () => null,
    });
    const response = await reads(
      ctx,
      restRequest('/api/v1/threads/thread_1/generation'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ status: 'idle' });
  });

  it('reports a live generation with its status', async () => {
    const { ctx } = restCtx({
      [GET]: () => thread({ generating: true }),
      [GENERATION]: () => ({ status: 'streaming', messageId: 'msg_1' }),
    });
    const response = await reads(
      ctx,
      restRequest('/api/v1/threads/thread_1/generation'),
    );
    expect(await jsonBody(response)).toEqual({
      status: 'streaming',
      messageId: 'msg_1',
    });
  });

  it('refuses a generation poll on a thread that is not the caller-s (404)', async () => {
    const { ctx, calls } = restCtx({ [GET]: () => null });
    const response = await reads(
      ctx,
      restRequest('/api/v1/threads/thread_x/generation'),
    );
    expect(response.status).toBe(404);
    expect(called(calls, GENERATION)).toBe(false);
  });

  it('answers 404 for an unknown sub-resource', async () => {
    const { ctx } = restCtx();
    expect(
      (await reads(ctx, restRequest('/api/v1/threads/thread_1/files'))).status,
    ).toBe(404);
  });
});

describe('POST /api/v1/threads/:id/messages', () => {
  const post = threadPostActions as unknown as Handler;
  const ready: StubRoutes = {
    [GET]: () => thread(),
    [START_TURN]: () => ({ status: 'completed' }),
  };

  it('schedules a direct turn and answers 202 with the poll target', async () => {
    const { ctx, calls } = restCtx(ready);
    const response = await post(
      ctx,
      restRequest('/api/v1/threads/thread_1/messages', {
        method: 'POST',
        json: { content: 'What changed?', model: 'gpt-5', locale: 'de' },
      }),
    );
    expect(response.status).toBe(202);
    expect(await jsonBody(response)).toEqual({
      threadId: 'thread_1',
      status: 'accepted',
      model: 'gpt-5',
      poll: '/api/v1/threads/thread_1/generation',
    });
    expect(argsOf(calls, START_TURN)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      threadId: 'thread_1',
      userText: 'What changed?',
      modelId: 'gpt-5',
      locale: 'de',
    });
  });

  it('refuses a body with no content or no model (400)', async () => {
    const { ctx, calls } = restCtx(ready);
    for (const json of [
      {},
      { content: 'hi' },
      { model: 'gpt-5' },
      { content: '   ', model: 'gpt-5' },
    ]) {
      const response = await post(
        ctx,
        restRequest('/api/v1/threads/thread_1/messages', {
          method: 'POST',
          json,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(called(calls, START_TURN)).toBe(false);
  });

  it('refuses a thread that is not the caller-s (404) without scheduling', async () => {
    const { ctx, calls } = restCtx({ ...ready, [GET]: () => null });
    const response = await post(
      ctx,
      restRequest('/api/v1/threads/thread_x/messages', {
        method: 'POST',
        json: { content: 'hi', model: 'gpt-5' },
      }),
    );
    expect(response.status).toBe(404);
    expect(called(calls, START_TURN)).toBe(false);
  });

  it('refuses a sandbox thread (409) — that lane has its own driver', async () => {
    const { ctx, calls } = restCtx({
      ...ready,
      [GET]: () => thread({ kind: 'sandbox', harness: 'claude-code' }),
    });
    const response = await post(
      ctx,
      restRequest('/api/v1/threads/thread_1/messages', {
        method: 'POST',
        json: { content: 'hi', model: 'gpt-5' },
      }),
    );
    expect(response.status).toBe(409);
    expect(called(calls, START_TURN)).toBe(false);
  });

  it('refuses a second concurrent turn (409)', async () => {
    const { ctx, calls } = restCtx({
      ...ready,
      [GET]: () => thread({ generating: true }),
    });
    const response = await post(
      ctx,
      restRequest('/api/v1/threads/thread_1/messages', {
        method: 'POST',
        json: { content: 'hi', model: 'gpt-5' },
      }),
    );
    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({
      error: 'This conversation is already generating a response.',
    });
    expect(called(calls, START_TURN)).toBe(false);
  });

  it('answers 404 for a POST that is not a message', async () => {
    const { ctx } = restCtx(ready);
    expect(
      (
        await post(
          ctx,
          restRequest('/api/v1/threads/thread_1/stop', { method: 'POST' }),
        )
      ).status,
    ).toBe(404);
  });
});
