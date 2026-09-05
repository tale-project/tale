// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  fetchWebsitePages,
  listWebsites,
  searchWebsiteContent,
} from '../domains/websites/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import type { RestEnv } from './shared.ts';
import { createRestWebsiteRoutes } from './v1-websites.ts';

vi.mock('../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));

// The corpus reads reach the per-org knowledge pool; here only the bounds
// the route hands them are under test.
vi.mock('../domains/websites/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/websites/service.ts')>()),
  fetchWebsitePages: vi.fn(() =>
    Promise.resolve({ pages: [], total: 0, offset: 0, hasMore: false }),
  ),
  listWebsites: vi.fn(() =>
    Promise.resolve({ page: [], isDone: true, continueCursor: '' }),
  ),
  searchWebsiteContent: vi.fn(() => Promise.resolve({ results: [], total: 0 })),
}));

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
  via: 'pool' | 'tx';
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

/** Tagged-template Sql double: the owned website for the loader, an id for
 * an insert, nothing else; records every query (tagged with the handle it
 * ran on) so a test can prove no write ran, or that one ran in `begin`. */
function fakeSql(): { sql: Sql; queries: Captured[]; txs: unknown[] } {
  const queries: Captured[] = [];
  const txs: unknown[] = [];
  const unsafe = (text: string) => ({ unsafe: text });
  const handle = (via: 'pool' | 'tx') => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values, via });
      if (text.includes('FROM app.websites WHERE id')) {
        return Promise.resolve([website]);
      }
      if (text.startsWith('INSERT INTO app.websites')) {
        return Promise.resolve([{ id: 'w-new' }]);
      }
      return Promise.resolve([]);
    };
    return Object.assign(tag, { unsafe });
  };
  const pool = Object.assign(handle('pool'), {
    begin: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = handle('tx');
      txs.push(tx);
      return callback(tx);
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: pool as unknown as Sql, queries, txs };
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

  // The domain is immutable after create: the corpus registration is
  // keyed by it, so a renamed row never claims a scan again and its old
  // registration is never released. Every `domain` — parseable or not —
  // is refused before the row is touched.
  it.each(['renamed.example', 'https://renamed.example/x', '::', 'a b'])(
    'PATCH /websites/{id} refuses domain %j as immutable with 400',
    async (domain) => {
      const { sql, queries } = fakeSql();
      const res = await send(sql, '/websites/w-1', 'PATCH', {
        domain,
        title: 'still fine',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          'domain is immutable after create; delete the website and re-add it under the new domain',
        code: 'WEBSITE_DOMAIN_IMMUTABLE',
      });
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

/**
 * The three corpus reads bound what they pass on. The regression under
 * test: `?limit=2.5` / `?offset=-1` reached `OFFSET`/`LIMIT` raw (a Postgres
 * error → 500), and pages/search accepted an unbounded limit — any key could
 * walk the organization's whole crawl inventory in one request.
 */
describe('website create', () => {
  it('writes the row and enqueues the register job in one transaction', async () => {
    const { sql, queries, txs } = fakeSql();
    const res = await send(sql, '/websites', 'POST', {
      domain: 'new.example',
      scanInterval: '1d',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'w-new' });
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.websites'),
    );
    expect(insert?.via).toBe('tx');
    expect(txs).toHaveLength(1);
    // The job rides the SAME transaction as the row: a rollback enqueues
    // nothing, a commit enqueues exactly once.
    expect(vi.mocked(addJobInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[0]).toBe(txs[0]);
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[1]).toBe('websites.register');
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[2]).toMatchObject({
      websiteId: 'w-new',
      domain: 'new.example',
      organizationId: 'org-1',
    });
  });
});

describe('website list bounds', () => {
  it('clamps and truncates limit for GET /websites', async () => {
    const { sql } = fakeSql();
    const app = mount(sql);
    for (const [limit, expected] of [
      ['2.5', 2],
      ['-1', 1],
      ['9999', 200],
      ['abc', 25],
    ] as const) {
      vi.mocked(listWebsites).mockClear();
      expect(
        (await app.request(`http://localhost/websites?limit=${limit}`)).status,
      ).toBe(200);
      expect(vi.mocked(listWebsites).mock.calls[0]?.[2]).toMatchObject({
        limit: expected,
      });
    }
  });

  it('floors offset at zero and caps limit for GET /websites/{id}/pages', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/websites/w-1/pages?offset=-1.5&limit=1e8',
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(fetchWebsitePages).mock.calls.at(-1)?.[2]).toEqual({
      offset: 0,
      limit: 500,
    });
    await mount(sql).request(
      'http://localhost/websites/w-1/pages?offset=2.7&limit=2.5',
    );
    expect(vi.mocked(fetchWebsitePages).mock.calls.at(-1)?.[2]).toEqual({
      offset: 2,
      limit: 2,
    });
  });

  it('caps the search limit for POST /websites/{id}/search', async () => {
    const { sql } = fakeSql();
    const res = await send(sql, '/websites/w-1/search', 'POST', {
      query: 'refunds',
      limit: 1e9,
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(searchWebsiteContent).mock.calls.at(-1)?.[2]).toEqual({
      query: 'refunds',
      limit: 100,
    });
  });
});
