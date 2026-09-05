// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PurgeIncompleteError } from '../domains/retention/service.ts';
import { parseKeysetCursor, type RestEnv } from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

// The documents door is driven against the real routes with only its two
// service calls replaced: the hub row loads, and the hard delete reports a
// purge the object store could not finish.
vi.mock('../domains/documents/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/documents/service.ts')>();
  return {
    ...actual,
    getDocumentById: vi.fn(async () => ({
      id: 'doc-hub',
      organizationId: 'org-1',
      projectId: null,
    })),
    deleteDocumentHard: vi.fn(async () => {
      throw new PurgeIncompleteError('doc-hub', [
        { ref: 's3:acme/doc-hub', stage: 'blob', message: 'store down' },
      ]);
    }),
  };
});

/**
 * GET /contacts and GET /products honour the pagination they document. The
 * regression under test: both routes emitted `continueCursor` / `isDone`
 * but never read `?cursor=`, so a spec-following pager received page one
 * forever and an organization with more rows than one page could never
 * enumerate the rest through the REST door. The cursor now reaches the
 * service as bound parameters, the emitted token round-trips through the
 * shared codec, and `limit` is clamped so no client value becomes a
 * negative or zero `LIMIT`.
 */

interface Captured {
  text: string;
  values: unknown[];
}

/** Tagged-template Sql double answering the list query with `rows`. */
function fakeSql(rows: object[]): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('$?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: Object.assign(tag, { unsafe }) as unknown as Sql, queries };
}

function contactRow(n: number) {
  return {
    id: `c-${n}`,
    organizationId: 'org-1',
    name: `Contact ${n}`,
    email: `c${n}@example.com`,
    phone: null,
    externalId: null,
    source: 'manual',
    locale: null,
    address: null,
    tags: [],
    metadata: null,
    notes: null,
    lifecycleStatus: null,
    createdAt: 1_700_000_000_000 - n,
    updatedAt: 1_700_000_000_000 - n,
  };
}

function productRow(n: number) {
  return {
    id: `p-${n}`,
    organizationId: 'org-1',
    name: `Product ${n}`,
    description: null,
    imageUrl: null,
    stock: null,
    price: null,
    currency: null,
    category: null,
    tags: [],
    status: 'active',
    translations: null,
    externalId: null,
    metadata: null,
    createdAt: 1_700_000_000_000 - n,
    updatedAt: 1_700_000_000_000 - n,
  };
}

/** The core routes behind a stub door that sets the request variables. */
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
  app.route('/', createCoreRoutes({ sql }));
  return app;
}

/** The single list query the route issued. */
function listQuery(queries: Captured[], table: string): Captured {
  const hit = queries.find((q) => q.text.includes(`FROM app.${table}`));
  if (!hit) throw new Error(`no query against app.${table}`);
  return hit;
}

const FAMILIES = [
  { route: '/contacts', table: 'contacts', row: contactRow },
  { route: '/products', table: 'products', row: productRow },
] as const;

describe.each(FAMILIES)('GET $route pagination', ({ route, table, row }) => {
  it('passes ?cursor= through to the service as the keyset bounds', async () => {
    const { sql, queries } = fakeSql([row(3), row(4)]);
    const res = await mount(sql).request(
      `http://localhost${route}?cursor=1699999999998:${table === 'contacts' ? 'c-2' : 'p-2'}&limit=2`,
    );
    expect(res.status).toBe(200);
    const { values } = listQuery(queries, table);
    expect(values).toContain(1_699_999_999_998);
    expect(values).toContain(table === 'contacts' ? 'c-2' : 'p-2');
    // limit + 1: the service over-fetches one row to learn whether more exist
    expect(values).toContain(3);
  });

  it('emits a continueCursor that round-trips into the next request', async () => {
    const { sql } = fakeSql([row(1), row(2), row(3)]);
    const res = await mount(sql).request(`http://localhost${route}?limit=2`);
    const body = (await res.json()) as {
      page: { id: string }[];
      isDone: boolean;
      continueCursor: string;
    };
    expect(body.page.map((item) => item.id)).toEqual(
      table === 'contacts' ? ['c-1', 'c-2'] : ['p-1', 'p-2'],
    );
    expect(body.isDone).toBe(false);
    const last = row(2);
    expect(parseKeysetCursor(body.continueCursor)).toEqual({
      at: last.updatedAt,
      id: last.id,
    });
  });

  it('answers isDone with an empty cursor on the last page', async () => {
    const { sql } = fakeSql([row(1), row(2)]);
    const res = await mount(sql).request(`http://localhost${route}?limit=2`);
    const body = (await res.json()) as {
      isDone: boolean;
      continueCursor: string;
    };
    expect(body.isDone).toBe(true);
    expect(body.continueCursor).toBe('');
  });

  it('reads an unparseable cursor as the first page', async () => {
    const { sql, queries } = fakeSql([row(1)]);
    const res = await mount(sql).request(
      `http://localhost${route}?cursor=%7B%22updatedAt%22%3A1%7D`,
    );
    expect(res.status).toBe(200);
    const { values } = listQuery(queries, table);
    // no keyset bound reached the query — the cursor slots are null
    expect(values).not.toContain(1);
  });

  it('clamps limit so no client value becomes a zero or negative LIMIT', async () => {
    for (const [limit, expected] of [
      ['0', 2],
      ['-4', 2],
      ['999', 201],
      ['abc', 26],
    ] as const) {
      const { sql, queries } = fakeSql([row(1)]);
      await mount(sql).request(`http://localhost${route}?limit=${limit}`);
      expect(listQuery(queries, table).values).toContain(expected);
    }
  });
});

describe('GET /products filters', () => {
  it('passes the documented status filter to the service', async () => {
    const { sql, queries } = fakeSql([productRow(1)]);
    const res = await mount(sql).request(
      'http://localhost/products?status=archived&category=tools',
    );
    expect(res.status).toBe(200);
    const { values } = listQuery(queries, 'products');
    expect(values).toContain('archived');
    expect(values).toContain('tools');
  });
});

/**
 * The agents family reuses the file layer, whose refusals are coded
 * AppErrors. The regression under test: the routes called it with no error
 * mapping, so editing an agent the key holder cannot edit or naming an
 * uppercase slug threw through Hono as a 500 — a permission or validation
 * failure reading as an outage. The internal /api/app/agents routes mapped
 * the same codes to 400/403/422 all along; both doors now share one map.
 * Driven against a real temporary config tree: the org slug falls back to
 * the door's `orgSlug` when the slug lookup finds no row.
 */
describe('agents error mapping', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-rest-agents-'));
    process.env.TALE_CONFIG_DIR = configRoot;
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) {
      delete process.env.TALE_CONFIG_DIR;
    } else {
      process.env.TALE_CONFIG_DIR = savedConfigDir;
    }
    await rm(configRoot, { recursive: true, force: true });
  });

  async function seedAgent(slug: string, yaml: string): Promise<void> {
    const dir = path.join(configRoot, 'acme', 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${slug}.yml`), yaml, 'utf-8');
  }

  const request = async (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    await mount(fakeSql([]).sql).request(`http://localhost${route}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  it('answers a permission refusal with 403', async () => {
    await seedAgent(
      'drafts',
      'name: drafts\ndisplay-name: Drafts\ndescription: Someone else’s\nvisibility: private\nowner: user-2\ninstructions: Keep quiet.\n',
    );
    const res = await request('/agents/drafts', {
      method: 'PUT',
      body: { displayName: 'Hijacked' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'AGENT_FORBIDDEN' });
  });

  it('answers an invalid slug with 400', async () => {
    const res = await request('/agents/Not_A_Slug');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'INVALID_AGENT_SLUG' });
  });

  it('answers a malformed agent file with 422', async () => {
    await seedAgent('broken', 'name: broken\ncolour: blue\n');
    const res = await request('/agents/broken');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'AGENT_MALFORMED' });
  });

  it('deletes with 204, and answers 404 for an agent that is not there', async () => {
    await seedAgent(
      'helper',
      'name: helper\ndisplay-name: Helper\ndescription: Shared\nvisibility: org\nowner: user-1\ninstructions: Help.\n',
    );
    expect((await request('/agents/helper', { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await request('/agents/helper', { method: 'DELETE' })).status).toBe(
      404,
    );
  });
});

/**
 * DELETE /documents/:id is the third door onto `deleteDocumentHard`. A purge
 * that could not remove every dead surface keeps the row for a retry and
 * throws PurgeIncompleteError — an error without a 4xx status, which
 * `domainErrorResponse` rethrows as a bare 500. The session and folder doors
 * answer it as 503 PURGE_INCOMPLETE; this pins the REST door to the same
 * shape so the three never drift.
 */
describe('DELETE /documents/:id purge mapping', () => {
  it('answers an incomplete purge as 503 PURGE_INCOMPLETE', async () => {
    const res = await mount(fakeSql([]).sql).request(
      'http://localhost/documents/doc-hub',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'PURGE_INCOMPLETE' });
  });
});
