// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseKeysetCursor, type RestEnv } from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

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

/** Tagged-template Sql double answering the list query with `rows`; an
 * optional `respond` answers a query by its text first (the rate limiter's
 * UPSERT/SELECT pair, say), falling back to `rows`. */
function fakeSql(
  rows: object[],
  respond?: (text: string) => object[] | undefined,
): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(respond?.(text) ?? rows);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: Object.assign(tag, { unsafe }) as unknown as Sql, queries };
}

/** The limiter's state for a spent bucket: the charging UPSERT returns no
 * row and the read-back finds an empty bucket. */
function spentBucket(text: string): object[] | undefined {
  if (text.includes('INSERT INTO app.rate_limits')) return [];
  if (text.includes('FROM app.rate_limits')) {
    return [{ value: '0', ts: String(Date.now()) }];
  }
  return undefined;
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
 * A body that is not JSON is a client mistake in the documented 400 envelope.
 * The regression under test: every write route handed `c.req.json()` — a
 * bare `JSON.parse` — straight to zod, so a truncated or empty `curl -d`
 * body threw a SyntaxError through Hono into the app-level handler: a
 * text/plain 500 outside the envelope, reported as a backend defect.
 */
describe('malformed JSON bodies', () => {
  const send = (route: string, method: string, body: string) =>
    mount(fakeSql([]).sql).request(`http://localhost${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body,
    });

  it.each([
    ['POST', '/contacts', '{'],
    ['POST', '/contacts', ''],
    ['POST', '/contacts/bulk', '{"contacts": ['],
    ['POST', '/products', 'not json'],
    ['PATCH', '/products/p-1', ''],
    ['POST', '/documents', '{'],
    ['PATCH', '/documents/d-1', '{'],
    ['POST', '/knowledge/search', ''],
    ['POST', '/knowledge-entries', '{'],
    ['PATCH', '/knowledge-entries/k-1', ''],
    ['PUT', '/agents/helper', '{'],
    ['PUT', '/skills/helper', ''],
  ])('%s %s with body %j answers 400 in the JSON envelope', async (method, route, body) => {
    const res = await send(route, method, body);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

/**
 * The knowledge-entry writes share the per-org `knowledge:mutate` budget
 * with their in-app twins. The regression under test: the charge ran inside
 * the try whose only catch maps CODED domain errors, and the limiter's
 * error carries no code — so a REST bulk import past the bucket got opaque
 * text/plain 500s (each captured as a backend defect) instead of the 429 +
 * `Retry-After` the spec promises on every route.
 */
describe('knowledge-entry writes over the knowledge:mutate budget', () => {
  const entry = { topic: 'Refunds', content: 'Refunds settle in 14 days.' };

  it.each([
    ['POST', '/knowledge-entries'],
    ['PATCH', '/knowledge-entries/k-1'],
    ['DELETE', '/knowledge-entries/k-1'],
  ])('%s %s answers 429 with Retry-After, and touches nothing else', async (method, route) => {
    const { sql, queries } = fakeSql([], spentBucket);
    const res = await mount(sql).request(`http://localhost${route}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(entry) }),
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: 'RATE_LIMITED' });
    const charge = queries.find((q) =>
      q.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('knowledge:mutate');
    expect(charge?.values).toContain('org:org-1');
    expect(
      queries.some((q) => q.text.includes('app.knowledge_entries')),
    ).toBe(false);
  });
});
