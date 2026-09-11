// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createRestWebsiteRoutes } from './v1-websites.ts';

/**
 * PATCH /websites/{id} validates what it parses. The regressions under
 * test: a JSON array passed the object guard (`typeof [] === 'object'`) and
 * answered 204 having changed nothing, and a `title` of the wrong type was
 * skipped in silence behind the same 204.
 */

const website = {
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'docs.example',
  kind: 'site',
  title: 'Docs',
  description: null,
  scanInterval: '1d',
  lastScannedAt: null,
  status: 'active',
  pageCount: 3,
  crawledPageCount: 3,
  metadata: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

function fakeSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('FROM app.websites')) return Promise.resolve([website]);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
  }) as unknown as Sql;
  return { sql, queries };
}

function mount() {
  const fake = fakeSql();
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
  app.route('/', createRestWebsiteRoutes({ sql: fake.sql }));
  return { app, queries: fake.queries };
}

const patch = (body: string) => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body,
});

describe('PATCH /websites/{id} body shape', () => {
  it('refuses a JSON array as the body', async () => {
    const { app, queries } = mount();
    const res = await app.request('http://localhost/websites/w-1', patch('[]'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    expect(queries.some((q) => q.startsWith('UPDATE app.websites'))).toBe(
      false,
    );
  });

  it('refuses a title of the wrong type instead of ignoring it', async () => {
    const { app, queries } = mount();
    const res = await app.request(
      'http://localhost/websites/w-1',
      patch('{"title": 5}'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('title'),
    });
    expect(queries.some((q) => q.startsWith('UPDATE app.websites'))).toBe(
      false,
    );
  });
});
