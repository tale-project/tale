/**
 * The knowledge-entries REST surface.
 *
 * Two things are easy to get wrong and are pinned here: a PATCH answers with the
 * id of the row it CREATED (an entry is superseded, never edited in place), and
 * a `status` filter the store does not know is a 400 rather than a silent
 * fallback to `active`.
 */

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  checkOrganizationRateLimit: vi.fn(),
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
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  patchKnowledgeEntry,
} from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LIST = 'knowledge_entries/rest_api:restListKnowledgeEntries';
const GET = 'knowledge_entries/rest_api:restGetKnowledgeEntry';
const CREATE = 'knowledge_entries/rest_api:restCreateKnowledgeEntry';
const UPDATE = 'knowledge_entries/rest_api:restUpdateKnowledgeEntry';
const DELETE = 'knowledge_entries/rest_api:restDeleteKnowledgeEntry';

function entry() {
  return {
    id: 'entry_1',
    topic: 'Refund policy',
    content: 'Refunds inside 30 days.',
    status: 'active',
    source: 'manual',
    createdBy: TEST_USER_ID,
    createdAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (listKnowledgeEntries as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/knowledge-entries'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/knowledge-entries', () => {
  it('pages the active entries of the key organization', async () => {
    const page = { page: [entry()], isDone: true, continueCursor: '' };
    const { ctx, calls } = restCtx({ [LIST]: () => page });
    const response = await (listKnowledgeEntries as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries?limit=3'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual(page);
    expect(argsOf(calls, LIST)).toEqual({
      organizationId: TEST_ORG_ID,
      cursor: null,
      limit: 3,
    });
  });

  it('accepts the superseded filter and refuses anything else (400)', async () => {
    const { ctx, calls } = restCtx({
      [LIST]: () => ({ page: [], isDone: true, continueCursor: '' }),
    });
    const ok = await (listKnowledgeEntries as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries?status=superseded'),
    );
    expect(ok.status).toBe(200);
    expect(argsOf(calls, LIST)?.status).toBe('superseded');

    const bad = await (listKnowledgeEntries as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries?status=deleted'),
    );
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/v1/knowledge-entries', () => {
  it('creates an entry attributed to the key holder', async () => {
    const { ctx, calls } = restCtx({ [CREATE]: () => 'entry_new' });
    const response = await (createKnowledgeEntry as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries', {
        method: 'POST',
        json: { topic: 'Refund policy', content: 'Refunds inside 30 days.' },
      }),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({ id: 'entry_new' });
    expect(argsOf(calls, CREATE)).toEqual({
      organizationId: TEST_ORG_ID,
      createdBy: TEST_USER_ID,
      topic: 'Refund policy',
      content: 'Refunds inside 30 days.',
    });
  });

  it('refuses a body without topic or content, and an over-long topic (400)', async () => {
    const { ctx, calls } = restCtx({ [CREATE]: () => 'entry_new' });
    for (const json of [
      {},
      { topic: 'x' },
      { content: 'y' },
      { topic: 'x'.repeat(200), content: 'y' },
    ]) {
      const response = await (createKnowledgeEntry as unknown as Handler)(
        ctx,
        restRequest('/api/v1/knowledge-entries', { method: 'POST', json }),
      );
      expect(response.status).toBe(400);
    }
    expect(called(calls, CREATE)).toBe(false);
  });

  it('maps a duplicate topic to 409', async () => {
    const { ctx } = restCtx({
      [CREATE]: () => {
        throw new ConvexError({
          code: 'KNOWLEDGE_ENTRY_DUPLICATE',
          message: 'An entry for "Refund policy" already exists.',
        });
      },
    });
    const response = await (createKnowledgeEntry as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries', {
        method: 'POST',
        json: { topic: 'Refund policy', content: 'again' },
      }),
    );
    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({
      error: 'An entry for "Refund policy" already exists.',
    });
  });
});

describe('GET, PATCH and DELETE /api/v1/knowledge-entries/:id', () => {
  it('answers one entry and 404 for one this organization does not have', async () => {
    const { ctx } = restCtx({ [GET]: () => entry() });
    expect(
      (
        await (getKnowledgeEntry as unknown as Handler)(
          ctx,
          restRequest('/api/v1/knowledge-entries/entry_1'),
        )
      ).status,
    ).toBe(200);

    const { ctx: none } = restCtx({ [GET]: () => null });
    const missing = await (getKnowledgeEntry as unknown as Handler)(
      none,
      restRequest('/api/v1/knowledge-entries/entry_x'),
    );
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toEqual({
      error: 'Knowledge entry not found',
    });
  });

  it('answers a PATCH with the id of the row it created', async () => {
    const { ctx, calls } = restCtx({ [UPDATE]: () => ({ id: 'entry_v2' }) });
    const response = await (patchKnowledgeEntry as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries/entry_1', {
        method: 'PATCH',
        json: { topic: 'Refund policy', content: 'Refunds inside 14 days.' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ id: 'entry_v2' });
    expect(argsOf(calls, UPDATE)).toEqual({
      organizationId: TEST_ORG_ID,
      updatedBy: TEST_USER_ID,
      entryId: 'entry_1',
      topic: 'Refund policy',
      content: 'Refunds inside 14 days.',
    });
  });

  it('maps editing a superseded version to 409', async () => {
    const { ctx } = restCtx({
      [UPDATE]: () => {
        throw new ConvexError({
          code: 'KNOWLEDGE_ENTRY_NOT_ACTIVE',
          message: 'This version has been superseded.',
        });
      },
    });
    const response = await (patchKnowledgeEntry as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries/entry_1', {
        method: 'PATCH',
        json: { topic: 'x', content: 'y' },
      }),
    );
    expect(response.status).toBe(409);
  });

  it('deletes with 204 and maps an unknown entry to 404', async () => {
    const { ctx } = restCtx({ [DELETE]: () => null });
    expect(
      (
        await (deleteKnowledgeEntry as unknown as Handler)(
          ctx,
          restRequest('/api/v1/knowledge-entries/entry_1', {
            method: 'DELETE',
          }),
        )
      ).status,
    ).toBe(204);

    const { ctx: none } = restCtx({
      [DELETE]: () => {
        throw new ConvexError({
          code: 'KNOWLEDGE_ENTRY_NOT_FOUND',
          message: 'No such knowledge entry for this organization.',
        });
      },
    });
    const missing = await (deleteKnowledgeEntry as unknown as Handler)(
      none,
      restRequest('/api/v1/knowledge-entries/entry_x', { method: 'DELETE' }),
    );
    expect(missing.status).toBe(404);
  });

  it('rejects a sub-path on every single-entry method', async () => {
    const { ctx } = restCtx({ [GET]: () => entry() });
    const response = await (getKnowledgeEntry as unknown as Handler)(
      ctx,
      restRequest('/api/v1/knowledge-entries/entry_1/versions'),
    );
    expect(response.status).toBe(404);
  });
});
