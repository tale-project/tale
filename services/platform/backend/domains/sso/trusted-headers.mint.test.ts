// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { requestWithMintedCookie } from '../../auth/minted-cookie.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { checkIpRateLimit } from '../../lib/rate-limit.ts';
import { resolveTrustedHeaderKey } from '../trusted_headers/service.ts';
import { trustedHeadersSessionMint } from './trusted-headers.ts';

/**
 * Transparent sign-in on the app's own requests: a GET that carries the
 * proxy's key and identity header but no session cookie is answered signed
 * in — the session minted on the spot, the cookie on the response and on
 * the request the gates read. Everything that must NOT mint is pinned here:
 * a POST, a cross-site fetch, a request without the headers, one holding a
 * session cookie already, one holding the app's hold cookie, and a key the
 * organization does not know.
 */

vi.mock('../trusted_headers/service.ts', () => ({
  resolveTrustedHeaderKey: vi.fn(),
  touchTrustedHeaderKeyLastUsed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/rate-limit.ts', () => {
  class RateLimitExceededError extends Error {
    readonly retryAfter: number;

    constructor(message: string, retryAfter: number) {
      super(message);
      this.name = 'RateLimitExceededError';
      this.retryAfter = retryAfter;
    }
  }
  return {
    checkIpRateLimit: vi.fn().mockResolvedValue(undefined),
    RateLimitExceededError,
  };
});

vi.mock('../two_factor/service.ts', () => ({
  anchorTwoFactorGraceOnSignIn: vi
    .fn()
    .mockResolvedValue({ decision: 'allowed' }),
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn().mockResolvedValue(null),
}));

vi.mock('./service.ts', () => ({
  syncTeamsFromGroupNames: vi.fn().mockResolvedValue({ errors: [] }),
}));

interface Captured {
  text: string;
  values: unknown[];
}

/** An existing member of org-1 with no session yet; audits answer inline. */
function fakeSql(): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.startsWith('SELECT last_hash AS "lastHash"')) {
      return Promise.resolve([{ lastHash: '', lastTs: 0 }]);
    }
    if (text.startsWith('INSERT INTO app.audit_logs')) {
      return Promise.resolve([{ id: 'audit-1' }]);
    }
    if (text.startsWith('SELECT "id", "name" FROM "user"')) {
      return Promise.resolve([{ id: 'user-1', name: 'Proxy User' }]);
    }
    if (text.startsWith('SELECT "role" FROM "member"')) {
      return Promise.resolve([{ role: 'member' }]);
    }
    return Promise.resolve([]);
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => cb(tag);
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    sql: Object.assign(tag, {
      begin,
      json: (value: unknown) => value,
    }) as unknown as Sql,
    queries,
  };
}

/**
 * The app under test: the mint, then a Better-Auth-shaped gate that reports
 * the cookie it was handed, and a `get-session` twin that reports what the
 * forwarded request carried.
 */
function makeApp() {
  const { sql, queries } = fakeSql();
  const seen: { gateCookie: string | null; forwardedCookie: string | null } = {
    gateCookie: null,
    forwardedCookie: null,
  };
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        seen.gateCookie = headers.get('cookie');
        return headers.get('cookie')?.includes('better-auth.session_token=')
          ? {
              user: { id: 'user-1', email: 'proxy.user@door.test', name: 'P' },
              session: { id: 's-1' },
            }
          : null;
      },
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  } as unknown as Auth;
  const app = new Hono<AuthEnv>();
  app.use('/api/app/*', trustedHeadersSessionMint({ sql }));
  app.use('/api/auth/get-session', trustedHeadersSessionMint({ sql }));
  app.get('/api/app/users/me', requireSession(auth), (c) =>
    c.json({ user: c.get('sessionBundle').user }),
  );
  app.get('/api/auth/get-session', (c) => {
    seen.forwardedCookie = requestWithMintedCookie(c.req.raw).headers.get(
      'cookie',
    );
    return c.json({ forwarded: true });
  });
  app.post('/api/app/anything', requireSession(auth), (c) => c.json({}));
  return { app, queries, seen };
}

const identity = {
  'Remote-Internal-Secret': 'thk_live',
  'Remote-Email': 'proxy.user@door.test',
  'Remote-Name': 'Proxy User',
  'Remote-Role': 'member',
};

const ENV_KEYS = ['BETTER_AUTH_SECRET', 'SITE_URL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.BETTER_AUTH_SECRET = 'session-signing-secret';
  delete process.env.SITE_URL;
  vi.mocked(resolveTrustedHeaderKey).mockReset().mockResolvedValue({
    keyId: 'key-1',
    organizationId: 'org-1',
    enabled: true,
    maxAssertedRole: 'admin',
  });
  vi.mocked(checkIpRateLimit).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const minted = (queries: Captured[]) =>
  queries.some((q) => q.text.startsWith('INSERT INTO "session"'));

describe('trustedHeadersSessionMint — signing the app in on its own request', () => {
  it('mints the session for a cookieless GET with the proxy headers, and the gate reads it', async () => {
    const { app, queries, seen } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me', {
      headers: identity,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { email: 'proxy.user@door.test' },
    });
    expect(res.headers.get('set-cookie')).toContain(
      'better-auth.session_token=',
    );
    expect(seen.gateCookie).toContain('better-auth.session_token=');
    expect(minted(queries)).toBe(true);
  });

  it("hands Better Auth's own session probe the minted cookie too", async () => {
    const { app, seen } = makeApp();

    const res = await app.request('http://localhost/api/auth/get-session', {
      headers: { ...identity, cookie: 'theme=dark' },
    });

    expect(res.status).toBe(200);
    expect(seen.forwardedCookie).toMatch(
      /^theme=dark; better-auth\.session_token=/,
    );
  });

  it('leaves a request without the proxy headers alone', async () => {
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me');

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(minted(queries)).toBe(false);
    expect(resolveTrustedHeaderKey).not.toHaveBeenCalled();
  });

  it('never mints on a POST — the proxy headers are not a CSRF token', async () => {
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/anything', {
      method: 'POST',
      headers: identity,
    });

    expect(res.status).toBe(401);
    expect(minted(queries)).toBe(false);
  });

  it('never mints for a cross-site fetch', async () => {
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me', {
      headers: { ...identity, 'sec-fetch-site': 'cross-site' },
    });

    expect(res.status).toBe(401);
    expect(minted(queries)).toBe(false);
  });

  it('steps aside when a session cookie is already there — stale or not, that is the sign-in page’s case', async () => {
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me', {
      headers: { ...identity, cookie: 'better-auth.session_token=old.sig' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(minted(queries)).toBe(false);
  });

  it("honours the app's hold after an inactivity sign-out", async () => {
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me', {
      headers: { ...identity, cookie: 'tale_handoff_hold=1' },
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(minted(queries)).toBe(false);
    expect(resolveTrustedHeaderKey).not.toHaveBeenCalled();
  });

  it('charges an unknown key to the source IP and goes on unauthenticated', async () => {
    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue(null);
    const { app, queries } = makeApp();

    const res = await app.request('http://localhost/api/app/users/me', {
      headers: { ...identity, 'x-forwarded-for': '203.0.113.9' },
    });

    expect(res.status).toBe(401);
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-headers:auth-fail-ip',
      '203.0.113.9',
    );
    expect(minted(queries)).toBe(false);
  });
});
