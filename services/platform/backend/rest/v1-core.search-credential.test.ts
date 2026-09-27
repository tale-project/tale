// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error.ts';
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
