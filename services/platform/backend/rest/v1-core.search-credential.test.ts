// @vitest-environment node

import { Hono } from 'hono';
import OpenAI from 'openai';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error.ts';
import {
  EmbeddingBudgetExceeded,
  EmbeddingNotConfigured,
} from '../core/knowledge/embedding.ts';
import { searchKnowledge } from '../core/knowledge/search.ts';
import {
  KnowledgeError,
  searchKnowledgeForOrg,
} from '../domains/knowledge/service.ts';
import type { RestEnv } from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

/**
 * `POST /knowledge/search` for an organization whose embedding model names a
 * provider with no usable credential behind it. The resolver refuses before
 * any provider call, and its `AppError` used to cross the retrieval
 * boundary untranslated: the REST door's domain mapping reads a `status`
 * an `AppError` does not carry, so the search answered a bare 500 where the
 * reference promises the 409 an admin lifts. The real domain translation
 * runs here; only the corpus search beneath it is replaced by the refusal
 * its embedder raises.
 */

vi.mock('../core/knowledge/search.ts', () => ({ searchKnowledge: vi.fn() }));

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('$?');
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

function mount() {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createCoreRoutes({ sql: fakeSql() }));
  return app;
}

const REMEDY =
  'No default credential is configured for provider "itest-vendor" — add one in Settings → AI providers, or select a credential explicitly.';

beforeEach(() => {
  vi.mocked(searchKnowledge).mockReset();
});

describe('knowledge search with a credential that does not resolve', () => {
  it('translates the refusal at the retrieval boundary', async () => {
    vi.mocked(searchKnowledge).mockRejectedValueOnce(
      new AppError({ code: 'CREDENTIAL_NONE_CONFIGURED', message: REMEDY }),
    );

    const caught = await searchKnowledgeForOrg(fakeSql(), {
      organizationId: 'org-1',
      spender: { userId: 'user-1', agentSlug: '__embedding__' },
      query: 'refunds',
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(KnowledgeError);
    expect(caught).toMatchObject({
      code: 'EMBEDDING_CREDENTIAL_REJECTED',
      status: 503,
    });
    // The resolver's own sentence, never its serialized payload.
    expect(caught).toHaveProperty(
      'message',
      `The organization's embedding model has no usable provider credential — an admin must add or fix it: ${REMEDY}`,
    );
  });

  it.each([
    'CREDENTIAL_NONE_CONFIGURED',
    'CREDENTIAL_NOT_FOUND',
    'CREDENTIAL_DISABLED',
    'CREDENTIAL_KEY_ROTATED',
    'CREDENTIAL_ENV_UNSET',
  ])(
    'answers %s over REST as the documented 409, never a 500',
    async (code) => {
      vi.mocked(searchKnowledge).mockRejectedValueOnce(
        new AppError({ code, message: REMEDY }),
      );

      const res = await mount().request('http://localhost/knowledge/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'refunds' }),
      });

      expect(res.status).toBe(409);
      // Waiting lifts nothing — no Retry-After to invite a retry.
      expect(res.headers.get('retry-after')).toBeNull();
      expect(await res.json()).toEqual({
        error: expect.stringContaining(REMEDY),
        code: 'EMBEDDING_CREDENTIAL_REJECTED',
      });
    },
  );
});

/**
 * The same boundary for the two other ways a search loses its embedding
 * model: there is none, or the provider behind it fails. What the caller
 * needs from the answer is whether waiting helps, so each class of failure
 * keeps its own code and only the one a wait can lift carries `Retry-After`.
 * The real domain translation runs here as well; the corpus search beneath it
 * is replaced by the failure its embedder raises.
 */
const search = () =>
  mount().request('http://localhost/knowledge/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'refunds' }),
  });

const providerError = (status: number, body: Record<string, unknown>) =>
  OpenAI.APIError.generate(status, body, undefined, new Headers());

describe('knowledge search without an embedding model', () => {
  it('answers 409 with the code an admin acts on, never a retry hint [KNOW-R10]', async () => {
    vi.mocked(searchKnowledge).mockRejectedValueOnce(
      new EmbeddingNotConfigured('acme'),
    );

    const res = await search();

    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.json()).toEqual({
      error: 'No embedding model is configured for this organization',
      code: 'EMBEDDING_NOT_CONFIGURED',
    });
  });
});

describe('knowledge search when the embedding provider fails', () => {
  it.each([
    [
      'a rate limit',
      providerError(429, {
        error: { code: 'rate_limit_exceeded', message: 'Too many requests' },
      }),
    ],
    [
      'an outage',
      providerError(503, { error: { message: 'The server is overloaded' } }),
    ],
  ])(
    'answers %s as 503 with the wait to retry after [KNOW-R12]',
    async (_case, failure) => {
      vi.mocked(searchKnowledge).mockRejectedValueOnce(failure);

      const res = await search();

      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(await res.json()).toMatchObject({
        code: 'EMBEDDING_UPSTREAM_ERROR',
      });
    },
  );

  it.each([
    [
      'a refused account',
      providerError(429, {
        error: {
          code: 'insufficient_quota',
          message: 'You exceeded your current quota',
        },
      }),
      'EMBEDDING_CREDIT_EXHAUSTED',
    ],
    [
      'a rejected key',
      providerError(401, {
        error: { code: 'invalid_api_key', message: 'Incorrect API key' },
      }),
      'EMBEDDING_CREDENTIAL_REJECTED',
    ],
  ])(
    'answers %s as 409 with no retry hint [KNOW-R12]',
    async (_case, failure, code) => {
      vi.mocked(searchKnowledge).mockRejectedValueOnce(failure);

      const res = await search();

      expect(res.status).toBe(409);
      expect(res.headers.get('retry-after')).toBeNull();
      expect(await res.json()).toMatchObject({ code });
    },
  );
});

describe('knowledge search at a usage limit', () => {
  it('answers the 429 every budget refusal answers, with the cap and its wait [GOV-R4] [KNOW-R18]', async () => {
    const resetsAt = Date.now() + 3_600_000;
    vi.mocked(searchKnowledge).mockRejectedValueOnce(
      new EmbeddingBudgetExceeded('Usage limit reached.', resetsAt, {
        scope: 'apiKey',
        code: 'REQUEST_LIMIT',
        period: 'daily',
        used: 50,
        limit: 50,
        reason: 'x',
        resetsAt,
      }),
    );

    const res = await search();

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(3_500);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('Usage limit reached'),
      code: 'BUDGET_EXCEEDED',
      data: {
        scope: 'apiKey',
        period: 'daily',
        limitCode: 'REQUEST_LIMIT',
        used: 50,
        limit: 50,
        resetsAt,
      },
    });
  });

  it('meters the query as the key holder’s spend [GOV-R5]', async () => {
    vi.mocked(searchKnowledge).mockResolvedValueOnce({
      hits: [],
      diagnostics: {},
    } as never);
    await search();
    expect(searchKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meter: expect.any(Object) }),
    );
  });
});
