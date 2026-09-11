// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createConversationRestRoutes } from './v1-conversations.ts';

/**
 * The conversations family follows the door's organization rule. The
 * regression under test: every conversation route demanded
 * `X-Organization-Slug` of every key — a single-organization key, which
 * the API reference says may omit the header (and which no route could
 * tell the slug to), was refused with a bare 400 — while a read-only role
 * got `FORBIDDEN` as the whole sentence.
 */

function fakeSql(memberOf: string[]): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve(
        memberOf.map((organizationId) => ({ organizationId, role: 'admin' })),
      );
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  }) as unknown as Sql;
  return { sql, queries };
}

function mount(memberOf: string[], role = 'admin') {
  const { sql, queries } = fakeSql(memberOf);
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createConversationRestRoutes({ sql }));
  return { app, queries };
}

const STATE =
  'http://localhost/conversations/sync?source=vatplus&externalId=x1';

describe('conversations door — organization rule', () => {
  it('serves a single-organization key that omits the header', async () => {
    const { app } = mount(['org-1']);
    const res = await app.request(STATE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: null });
  });

  it('refuses a multi-organization key that omits the header with the coded 400', async () => {
    const { app } = mount(['org-1', 'org-2']);
    const res = await app.request(STATE);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ORG_SLUG_REQUIRED' });
  });

  it('names the role refusal with a code, not as the whole message', async () => {
    const { app } = mount(['org-1'], 'member');
    const res = await app.request(STATE);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('member'),
      code: 'ROLE_FORBIDDEN',
    });
  });

  it('names the query parameter a refused read is missing', async () => {
    const { app } = mount(['org-1']);
    const res = await app.request(
      'http://localhost/conversations/sync?source=vatplus',
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [expect.objectContaining({ path: 'externalId' })] },
    });
  });
});
