/**
 * The knowledge-search REST endpoint.
 *
 * Both organization identifiers must reach the node action from the KEY, never
 * from the body — the id resolves the embedding credential, the slug resolves
 * the corpus, and a caller who could name either could search another tenant's
 * knowledge with their own credential. That is the first thing asserted here.
 *
 * The second is the refusal: an organization with no embedding model configured
 * gets 409 and the message that says what to configure, never an empty hit list
 * that would read as "nothing is known".
 */

import { ConvexError } from 'convex/values';
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
  TEST_ORG_SLUG,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import { searchKnowledge } from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const SEARCH = 'node_only/knowledge/search_action:searchOrgKnowledge';

const result = {
  hits: [
    {
      id: 'chunk_1',
      corpus: 'documents',
      text: 'Refunds inside 30 days.',
      source: { ref: 'doc_1', title: 'Refund policy' },
      chunkIndex: 0,
      score: 0.42,
      fusedScore: 0.9,
    },
  ],
  diagnostics: { bm25: true, reranked: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('POST /api/v1/knowledge/search', () => {
  const search = searchKnowledge as unknown as Handler;

  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await search(
      ctx,
      anonymousRequest('/api/v1/knowledge/search', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('searches with the organization from the key and returns the hits', async () => {
    const { ctx, calls } = restCtx({ [SEARCH]: () => result });
    const response = await search(
      ctx,
      restRequest('/api/v1/knowledge/search', {
        method: 'POST',
        json: { query: 'refund window', corpus: 'documents', limit: 5 },
      }),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual(result);
    expect(argsOf(calls, SEARCH)).toEqual({
      organizationId: TEST_ORG_ID,
      orgSlug: TEST_ORG_SLUG,
      query: 'refund window',
      corpus: 'documents',
      limit: 5,
    });
  });

  it('ignores an organization named in the body — the key decides', async () => {
    const { ctx, calls } = restCtx({ [SEARCH]: () => result });
    await search(
      ctx,
      restRequest('/api/v1/knowledge/search', {
        method: 'POST',
        json: {
          query: 'refund window',
          organizationId: 'org_someone_else',
          orgSlug: 'someone-else',
        },
      }),
    );
    expect(argsOf(calls, SEARCH)).toEqual({
      organizationId: TEST_ORG_ID,
      orgSlug: TEST_ORG_SLUG,
      query: 'refund window',
    });
  });

  it('refuses a missing query, a bad corpus and an out-of-range limit (400)', async () => {
    const { ctx, calls } = restCtx({ [SEARCH]: () => result });
    for (const json of [
      {},
      { query: '   ' },
      { query: 'x', corpus: 'everything' },
      { query: 'x', limit: 0 },
      { query: 'x', limit: 500 },
      { query: 'x', minSimilarity: 2 },
    ]) {
      const response = await search(
        ctx,
        restRequest('/api/v1/knowledge/search', { method: 'POST', json }),
      );
      expect(response.status).toBe(400);
    }
    expect(called(calls, SEARCH)).toBe(false);
  });

  it('answers 409 with the message when no embedding model is configured', async () => {
    const message =
      'Organization "rest-kit" has no embedding model configured, so its knowledge cannot be indexed or searched.';
    const { ctx } = restCtx({
      [SEARCH]: () => {
        throw new ConvexError({
          code: 'KNOWLEDGE_EMBEDDING_NOT_CONFIGURED',
          message,
        });
      },
    });
    const response = await search(
      ctx,
      restRequest('/api/v1/knowledge/search', {
        method: 'POST',
        json: { query: 'refund window' },
      }),
    );
    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({ error: message });
  });

  it('refuses a body that is not a JSON object (400)', async () => {
    const { ctx } = restCtx({ [SEARCH]: () => result });
    for (const body of ['[]', 'null', 'not json']) {
      const response = await search(
        ctx,
        restRequest('/api/v1/knowledge/search', {
          method: 'POST',
          json: body,
        }),
      );
      expect(response.status).toBe(400);
    }
  });
});
