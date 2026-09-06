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
  expiresAt: 1_700_000_000_000,
  lastUsedAt: null,
  failureCount: 0,
};

/** Tagged-template Sql double: answers the service's membership read with
 * `members`, the pool listing with one masked row, the INSERT with an id. */
function fakeSql(members: { organizationId: string; role: string }[]): {
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
    expect(listing?.text).not.toContain('cookies_encrypted');
  });
});

describe('POST /browser-sessions/import', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses a malformed body before touching the service', async () => {
    const { sql, queries } = fakeSql(ADMIN);
    const res = await mount(sql).request(
      importRequest({ domain: 'youtube.com' }),
    );
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
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
