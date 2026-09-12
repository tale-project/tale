// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSafeFetchResolverForTests } from '../../lib/net/safe-fetch.ts';
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
function fakeSql(options: { existingByDomain?: boolean } = {}): {
  sql: Sql;
  queries: Captured[];
  txs: unknown[];
} {
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
      if (
        options.existingByDomain &&
        text.includes('FROM app.websites') &&
        text.includes('domain')
      ) {
        return Promise.resolve([website]);
      }
      if (text.startsWith('INSERT INTO app.websites')) {
        return Promise.resolve([{ id: 'w-new' }]);
      }
      // The patch's RETURNING: the row as it now stands.
      if (text.startsWith('UPDATE app.websites')) {
        return Promise.resolve([
          { ...website, updatedAt: website.updatedAt + 1 },
        ]);
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
  it.each(['https://', 'a b', '::', 'x'.repeat(260), 'file:///etc/passwd'])(
    'POST /websites refuses the unparseable domain %j with 400',
    async (domain) => {
      const { sql, queries } = fakeSql();
      const res = await send(sql, '/websites', 'POST', {
        domain,
        scanInterval: '1d',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'WEBSITE_DOMAIN_INVALID',
      });
      expect(queries).toEqual([]);
    },
  );

  /**
   * A registered domain is a server-side fetch target the crawler dials
   * from inside the deployment's network. The regression under test: the
   * door registered `localhost`, `127.0.0.1` and the cloud metadata
   * address, and the crawler's own host allowlist then let them through.
   */
  it.each([
    'localhost',
    'http://localhost:3000',
    '127.0.0.1',
    '169.254.169.254',
    'https://[::1]/',
    '10.0.0.8',
    'metadata.google.internal',
    'intranet',
  ])(
    'POST /websites refuses the uncrawlable target %j with 400',
    async (domain) => {
      const before = process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS;
      delete process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS;
      try {
        const { sql, queries } = fakeSql();
        const res = await send(sql, '/websites', 'POST', {
          domain,
          scanInterval: '1d',
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          code: 'WEBSITE_DOMAIN_NOT_CRAWLABLE',
        });
        expect(queries).toEqual([]);
      } finally {
        if (before !== undefined)
          process.env.TALE_ALLOW_PRIVATE_CRAWL_HOSTS = before;
      }
    },
  );

  it('refuses an unknown key, a bad scanInterval and a non-object body with INVALID_BODY', async () => {
    const { sql, queries } = fakeSql();
    for (const body of [
      { domain: 'docs.example', scanInterval: '1d', colour: 'blue' },
      { domain: 'docs.example', scanInterval: '2d' },
      [],
    ]) {
      const res = await send(sql, '/websites', 'POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    }
    expect(queries).toEqual([]);
  });

  // The domain is immutable after create: the corpus registration is
  // keyed by it, so a renamed row never claims a scan again and its old
  // registration is never released. Every CHANGED `domain` — parseable or
  // not — is refused before the row is touched.
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

  // A PUT-style client echoes the resource it read, `domain` included:
  // the stored value is not a rename and passes.
  it.each(['docs.example', ' DOCS.EXAMPLE '])(
    'PATCH /websites/{id} accepts domain %j as the stored value echoed',
    async (domain) => {
      const { sql, queries } = fakeSql();
      const res = await send(sql, '/websites/w-1', 'PATCH', {
        domain,
        title: 'Echoed',
      });
      expect(res.status).toBe(200);
      expect(
        queries.some((q) => q.text.startsWith('UPDATE app.websites')),
      ).toBe(true);
    },
  );

  /** A 204 left a client that sent the patch without the new `updatedAt`
   * or `status`; the door now answers the website as it stands. */
  it('PATCH /websites/{id} answers 200 with the updated website', async () => {
    const { sql, queries } = fakeSql();
    const res = await send(sql, '/websites/w-1', 'PATCH', {
      scanInterval: '1d',
      title: 'Renamed docs',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      id: 'w-1',
      domain: 'docs.example',
      updatedAt: website.updatedAt + 1,
    });
    const update = queries.find((q) =>
      q.text.startsWith('UPDATE app.websites'),
    );
    expect(update?.values).toEqual(
      expect.arrayContaining(['Renamed docs', '1d', 'w-1']),
    );
  });

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

  /** Re-posting a URL list onto a registered domain extends it — and says
   * so: 200 with the EXISTING id, where a 201 claimed a fresh resource. */
  it('answers 200 with the existing id when a list merges into a registered domain', async () => {
    vi.mocked(addJobInTx).mockClear();
    const { sql, queries } = fakeSql({ existingByDomain: true });
    const res = await send(sql, '/websites', 'POST', {
      domain: 'docs.example',
      scanInterval: '1d',
      urls: ['https://docs.example/one'],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'w-1' });
    expect(queries.some((q) => q.text.startsWith('INSERT'))).toBe(false);
    expect(vi.mocked(addJobInTx)).toHaveBeenCalledTimes(1);
  });
});

/**
 * The crawler corpus keeps snake_case rows stamped with ISO-8601 text; the
 * door translates them into the camelCase / epoch-ms vocabulary every other
 * family speaks, so a client needs one set of names and one clock.
 */
describe('website corpus views', () => {
  it('answers pages in camelCase with epoch-ms timestamps', async () => {
    vi.mocked(fetchWebsitePages).mockResolvedValueOnce({
      pages: [
        {
          url: 'https://docs.example/a',
          title: 'A',
          word_count: 12,
          status: 'crawled',
          content_hash: 'abc',
          last_crawled_at: '2026-01-02T03:04:05.000Z',
          discovered_at: null,
          chunks_count: 2,
          indexed: true,
        },
      ],
      total: 1,
      offset: 0,
      hasMore: false,
    });
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/websites/w-1/pages');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pages: [
        {
          url: 'https://docs.example/a',
          title: 'A',
          wordCount: 12,
          status: 'crawled',
          contentHash: 'abc',
          lastCrawledAt: Date.parse('2026-01-02T03:04:05.000Z'),
          discoveredAt: null,
          chunksCount: 2,
          indexed: true,
        },
      ],
      total: 1,
      offset: 0,
      hasMore: false,
    });
  });

  it('answers search hits in camelCase with one content field', async () => {
    vi.mocked(searchWebsiteContent).mockResolvedValueOnce({
      results: [
        {
          url: 'https://docs.example/a',
          title: 'A',
          chunk_content: 'raw chunk',
          core_content: 'the passage',
          chunk_index: 3,
          score: 0.5,
        },
        {
          url: 'https://docs.example/b',
          title: null,
          chunk_content: 'legacy chunk',
          chunk_index: 0,
          score: 0.25,
        },
      ],
      total: 2,
    });
    const { sql } = fakeSql();
    const res = await send(sql, '/websites/w-1/search', 'POST', {
      query: 'passage',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        {
          url: 'https://docs.example/a',
          title: 'A',
          content: 'the passage',
          chunkIndex: 3,
          score: 0.5,
        },
        {
          url: 'https://docs.example/b',
          title: null,
          content: 'legacy chunk',
          chunkIndex: 0,
          score: 0.25,
        },
      ],
      total: 2,
    });
  });

  it('refuses a search body with an unknown key or an empty query', async () => {
    const { sql } = fakeSql();
    for (const body of [{ query: '' }, { query: 'x', page: 2 }]) {
      const res = await send(sql, '/websites/w-1/search', 'POST', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    }
  });
});

describe('website list bounds', () => {
  it('clamps an out-of-range whole-number limit for GET /websites', async () => {
    const { sql } = fakeSql();
    const app = mount(sql);
    for (const [limit, expected] of [
      ['-1', 1],
      ['9999', 200],
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

  it('refuses a non-numeric limit and a mangled cursor with 400, listing nothing', async () => {
    const { sql } = fakeSql();
    const app = mount(sql);
    vi.mocked(listWebsites).mockClear();
    const limit = await app.request('http://localhost/websites?limit=abc');
    expect(limit.status).toBe(400);
    expect(await limit.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    const cursor = await app.request(
      'http://localhost/websites?cursor=malformed-eval-cursor',
    );
    expect(cursor.status).toBe(400);
    expect(await cursor.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    expect(listWebsites).not.toHaveBeenCalled();
  });

  it('caps limit and takes a whole-number offset for GET /websites/{id}/pages', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/websites/w-1/pages?offset=2&limit=99999',
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(fetchWebsitePages).mock.calls.at(-1)?.[2]).toEqual({
      offset: 2,
      limit: 500,
    });
  });

  it('refuses a fractional, negative or non-numeric offset instead of reading it as zero', async () => {
    const { sql } = fakeSql();
    vi.mocked(fetchWebsitePages).mockClear();
    for (const offset of ['-1', '2.7', 'abc']) {
      const res = await mount(sql).request(
        `http://localhost/websites/w-1/pages?offset=${offset}`,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'INVALID_QUERY',
        data: { issues: [{ path: 'offset' }] },
      });
    }
    const limit = await mount(sql).request(
      'http://localhost/websites/w-1/pages?limit=2.5',
    );
    expect(limit.status).toBe(400);
    expect(await limit.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    expect(fetchWebsitePages).not.toHaveBeenCalled();
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

/**
 * A registration names a server-side fetch target, so the name's DNS answer
 * is checked at the door too: a public-looking host whose record points at
 * a loopback, private-network or cloud-metadata address is refused before
 * a row exists (the crawler resolves, checks and pins again on every dial).
 */
describe('website create — resolved-address policy', () => {
  afterEach(() => {
    setSafeFetchResolverForTests(null);
  });

  it('refuses a domain that resolves to a private or metadata address with the crawl-policy code', async () => {
    setSafeFetchResolverForTests(() =>
      Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    );
    const { sql, queries } = fakeSql();
    const res = await send(sql, '/websites', 'POST', {
      domain: '127.0.0.1.nip.io',
      scanInterval: '1d',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'WEBSITE_DOMAIN_NOT_CRAWLABLE',
      error: expect.stringContaining('127.0.0.1'),
    });
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO app.websites')),
    ).toBe(false);
  });

  it('registers a domain DNS cannot answer yet — the scan reports that on its own', async () => {
    setSafeFetchResolverForTests(() => Promise.reject(new Error('ENOTFOUND')));
    const { sql } = fakeSql();
    const res = await send(sql, '/websites', 'POST', {
      domain: 'brand-new.example',
      scanInterval: '1d',
    });
    expect(res.status).toBe(201);
  });
});
