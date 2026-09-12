// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createRestBrowserSessionRoutes } from './v1-browser-sessions.ts';

/**
 * The browser-session pool's only door. The regression under test: the pool
 * (claimed by the video-link ingest) had no producer anywhere — its list +
 * import lived on an `/api/app` route no client called, and the docs named a
 * retired 0.4 internal action — so every deployment ran with an empty pool.
 * The family now rides the REST machine door: the listing is masked, the
 * import keeps the service's instance-admin + editor-allowlist gate on the
 * key holder, and the jar is encrypted before the INSERT sees it.
 */

vi.mock('../core/lib/crypto/encrypt_string.ts', () => ({
  encryptString: (plaintext: string) => Promise.resolve(`jwe:${plaintext}`),
}));

interface Captured {
  text: string;
  values: unknown[];
}

const LISTED = {
  id: 'bs-1',
  domain: 'youtube.com',
  label: 'Session A',
  status: 'healthy',
  createdAt: 1_699_000_000_000,
  expiresAt: 1_700_000_000_000,
  lastUsedAt: null,
  failureCount: 0,
};

/** Tagged-template Sql double: answers the service's membership read with
 * `members`, the pool listing with one masked row, the INSERT with an id,
 * the DELETE with the row it removed (none by default). */
function fakeSql(
  members: { organizationId: string; role: string }[],
  options: { deletes?: { id: string }[] } = {},
): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve(members);
    }
    if (text.includes('INSERT INTO app.browser_sessions')) {
      return Promise.resolve([{ id: 'bs-new' }]);
    }
    if (text.includes('DELETE FROM app.browser_sessions')) {
      return Promise.resolve(options.deletes ?? []);
    }
    if (text.includes('FROM app.browser_sessions')) {
      return Promise.resolve([LISTED]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

/** The family behind a stub door that sets the request variables. */
function mount(sql: Sql, role = 'admin') {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'ops@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createRestBrowserSessionRoutes({ sql }));
  return app;
}

const JAR =
  '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret';

function importRequest(body: unknown) {
  return new Request('http://localhost/browser-sessions/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ADMIN = [{ organizationId: 'org-1', role: 'admin' }];
const MEMBER = [{ organizationId: 'org-1', role: 'member' }];

describe('GET /browser-sessions', () => {
  it('lists the key holder org’s pool, masked', async () => {
    const { sql, queries } = fakeSql(MEMBER);
    const res = await mount(sql, 'member').request(
      'http://localhost/browser-sessions',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [LISTED] });
    const listing = queries.find((q) =>
      q.text.includes('FROM app.browser_sessions'),
    );
    expect(listing?.values).toEqual(['org-1']);
    // The import time is projected (G-07c): a session names when it was
    // added, not only when it expires.
    expect(listing?.text).toContain('created_at_ms::float8 AS "createdAt"');
    expect(listing?.text).not.toContain('cookies_encrypted');
  });
});

describe('POST /browser-sessions/import', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * The gate runs before the body is read: a caller who will be refused
   * gets the 403 and nothing else — no schema feedback, no field list.
   * (The order used to be the other way round, and a test pinned it.)
   */
  it('refuses an unauthorized caller before reading the body — a malformed body gets the 403, not the schema', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'someone-else@example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(importRequest({}));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN_DEPLOYMENT_EDITOR',
    });
    expect(queries.map((q) => q.text)).toEqual([
      expect.stringContaining('FROM "member" WHERE "userId"'),
    ]);
  });

  it('refuses a malformed body from an allowlisted administrator, and inserts nothing', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain: 'youtube.com' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      error: 'invalid body: "cookiesJar" is required',
    });
    expect(queries.some((q) => q.text.includes('INSERT'))).toBe(false);
  });

  it.each([
    ['a whitespace-only domain', { domain: '   ', cookiesJar: JAR }, 'domain'],
    [
      'a whitespace-only jar',
      { domain: 'youtube.com', cookiesJar: ' \n ' },
      'cookiesJar',
    ],
    [
      'a lifetime past 180 days',
      {
        domain: 'youtube.com',
        cookiesJar: JAR,
        ttlMs: 181 * 24 * 60 * 60 * 1000,
      },
      'ttlMs',
    ],
    [
      'an unknown key',
      { domain: 'youtube.com', cookiesJar: JAR, cookies: 'x' },
      'cookies',
    ],
  ])('refuses %s by field', async (_name, body, field) => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(importRequest(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      error: expect.stringContaining(`"${field}"`),
    });
    expect(queries.some((q) => q.text.includes('INSERT'))).toBe(false);
  });

  it.each([
    ['localhost', 'localhost'],
    ['a loopback address', '127.0.0.1'],
    ['a path, not a host', '../etc/passwd'],
    ['a wildcard', '*.example.com'],
    ['a non-http scheme', 'ftp://example.com'],
  ])('refuses %s as the domain with INVALID_SESSION', async (_name, domain) => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    vi.stubEnv('TALE_ALLOW_PRIVATE_CRAWL_HOSTS', '');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain, cookiesJar: JAR }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_SESSION' });
    expect(queries.some((q) => q.text.includes('INSERT'))).toBe(false);
  });

  it('normalizes a URL-shaped domain to its host', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain: 'HTTPS://Example.COM/path', cookiesJar: JAR }),
    );
    expect(res.status).toBe(201);
    const insert = queries.find((q) =>
      q.text.includes('INSERT INTO app.browser_sessions'),
    );
    expect(insert?.values).toContain('example.com');
  });

  it('refuses a key whose holder administers no organization', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql, queries } = fakeSql(MEMBER);
    const res = await mount(sql, 'member').request(
      importRequest({ domain: 'youtube.com', cookiesJar: JAR }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN_INSTANCE_ADMIN',
    });
    expect(queries.some((q) => q.text.includes('INSERT'))).toBe(false);
  });

  it('refuses an administrator who is not on the deployment editor allowlist', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'someone-else@example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain: 'youtube.com', cookiesJar: JAR }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN_DEPLOYMENT_EDITOR',
    });
    expect(queries.some((q) => q.text.includes('INSERT'))).toBe(false);
  });

  it('imports for an allowlisted administrator, storing only the encrypted jar', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'Ops@Example.com');
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain: 'YouTube.com', cookiesJar: JAR, label: 'A' }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sessionId: 'bs-new' });
    const insert = queries.find((q) =>
      q.text.includes('INSERT INTO app.browser_sessions'),
    );
    expect(insert).toBeDefined();
    expect(insert?.values).toContain('org-1');
    expect(insert?.values).toContain('youtube.com');
    expect(insert?.values).toContain(`jwe:${JAR}`);
    expect(insert?.values).not.toContain(JAR);
    expect(insert?.values).toContain('user-1');
  });
});

/**
 * The revocation path a credential store needs: an imported jar can be
 * removed by exactly the operators who may import one; an unknown or
 * foreign-organization id reads as absent.
 */
describe('DELETE /browser-sessions/{id}', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const del = (sql: Sql, role = 'admin') =>
    mount(sql, role).request('http://localhost/browser-sessions/bs-1', {
      method: 'DELETE',
    });

  it('sits behind the importer gate', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'someone-else@example.com');
    const { sql, queries } = fakeSql(ADMIN, { deletes: [{ id: 'bs-1' }] });
    const res = await del(sql);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'FORBIDDEN_DEPLOYMENT_EDITOR',
    });
    expect(queries.some((q) => q.text.includes('DELETE'))).toBe(false);
  });

  it('removes the session of this organization with 204', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql, queries } = fakeSql(ADMIN, { deletes: [{ id: 'bs-1' }] });
    const res = await del(sql);
    expect(res.status).toBe(204);
    const remove = queries.find((q) => q.text.includes('DELETE'));
    expect(remove?.text).toContain('org_id = $?');
    expect(remove?.values).toEqual(['bs-1', 'org-1']);
  });

  it('answers 404 with its own code when nothing of this organization went away', async () => {
    vi.stubEnv('TALE_DEPLOYMENT_CONFIG_ADMINS', 'ops@example.com');
    const { sql } = fakeSql(ADMIN);
    const res = await del(sql);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Browser session not found',
      code: 'BROWSER_SESSION_NOT_FOUND',
    });
  });
});
