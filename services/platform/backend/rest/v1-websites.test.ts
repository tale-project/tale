// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createRestWebsiteRoutes } from './v1-websites.ts';

/**
 * The /websites family validates what it parses. The regression under test:
 * POST ran `new URL()` on the caller's `domain` outside any try, and PATCH
 * forwarded it to the domain's own `new URL()` — so `https://`, `a b`, `::`
 * threw a TypeError through Hono into the app-level handler (a text/plain
 * 500, reported as a backend defect) two lines after the same routes had
 * answered 400 for a missing field. `title`/`description` had no bound.
 */

interface Captured {
  text: string;
  values: unknown[];
}

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
  updatedAt: 1_700_000_000_001,
};

/** Tagged-template Sql double: the owned website for the loader, nothing
 * else; records every query so a test can prove no write ran. */
function fakeSql(): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.websites WHERE id')) {
      return Promise.resolve([website]);
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: Object.assign(tag, { unsafe }) as unknown as Sql, queries };
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
  app.route('/', createRestWebsiteRoutes({ sql }));
  return app;
}

const send = (sql: Sql, route: string, method: string, body: unknown) =>
  mount(sql).request(`http://localhost${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('website domain and field validation', () => {
  it.each(['https://', 'a b', '::', 'x'.repeat(260)])(
    'POST /websites refuses the unparseable domain %j with 400',
    async (domain) => {
      const { sql, queries } = fakeSql();
      const res = await send(sql, '/websites', 'POST', {
        domain,
        scanInterval: '1d',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid domain' });
      expect(queries).toEqual([]);
    },
  );

  it.each(['::', 'https://', 'a b'])(
    'PATCH /websites/{id} refuses the unparseable domain %j with 400',
    async (domain) => {
      const { sql, queries } = fakeSql();
      const res = await send(sql, '/websites/w-1', 'PATCH', { domain });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid domain' });
      expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
    },
  );

  it('bounds title and description on create and patch', async () => {
    const { sql } = fakeSql();
    const tooLong = 'x'.repeat(201);
    const created = await send(sql, '/websites', 'POST', {
      domain: 'docs.example',
      scanInterval: '1d',
      title: tooLong,
    });
    expect(created.status).toBe(400);
    const patched = await send(sql, '/websites/w-1', 'PATCH', {
      description: 'y'.repeat(2001),
    });
    expect(patched.status).toBe(400);
  });
});
