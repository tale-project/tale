// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../auth/auth.ts';
import { createRestV1Routes } from './v1.ts';

/**
 * The /api/v1 door's rate-limit attribution. The regression under test: the
 * door keyed `rest:api` on the LEFTMOST `X-Forwarded-For` entry — the one
 * the caller writes — and charged it BEFORE authentication, so rotating the
 * header minted unlimited fresh buckets, pinning a victim's NAT IP starved
 * their traffic, and strangers drained budgets without a key. Now an
 * authenticated request charges the key holder (`user:<id>`), a failed key
 * charges the trusted-proxy-derived IP on its own lane, and a request with
 * no Bearer header charges nothing at all.
 */

vi.mock('../auth/auth.ts', () => ({
  API_KEY_RATE_LIMIT: { enabled: true, timeWindow: 60_000, maxRequests: 100 },
  loadTrustedProxies: () => Promise.resolve(['loopback', 'uniquelocal']),
}));

interface Charge {
  name: unknown;
  key: unknown;
}

/**
 * Tagged-template Sql double: answers the door's membership lookups, plays
 * the rate limiter's UPSERT/SELECT pair (a charge on an `exhausted` lane
 * UPSERTs nothing and reads back an empty bucket), and records every charge.
 */
function fakeSql(exhausted: Set<string> = new Set()): {
  sql: Sql;
  charges: Charge[];
} {
  const charges: Charge[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      const [name, key] = values;
      charges.push({ name, key });
      return Promise.resolve(
        exhausted.has(`${String(name)}|${String(key)}`) ? [] : [{ value: '1' }],
      );
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve([{ organizationId: 'org-1', role: 'member' }]);
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('FROM "member" WHERE "organizationId"')) {
      return Promise.resolve([
        {
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'member',
        },
      ]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, charges };
}

const GOOD_KEY = 'tale_good';

/** getSession double: `GOOD_KEY` is user-1; anything else is no session;
 * `throws` makes the lookup fail the way Better Auth reports it. */
function fakeAuth(throws?: unknown): {
  auth: Auth;
  getSession: ReturnType<typeof vi.fn>;
} {
  const getSession = vi.fn(({ headers }: { headers: Headers }) => {
    if (throws !== undefined) return Promise.reject(throws);
    return Promise.resolve(
      headers.get('x-api-key') === GOOD_KEY
        ? { user: { id: 'user-1', email: 'user@example.com' }, session: {} }
        : null,
    );
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { auth: { api: { getSession } } as unknown as Auth, getSession };
}

function door(sql: Sql, auth: Auth) {
  const app = createRestV1Routes({ sql, auth });
  app.get('/probe', (c) =>
    c.json({ userId: c.get('userId'), clientIp: c.get('clientIp') }),
  );
  return app;
}

function bearer(key: string, extra: Record<string, string> = {}) {
  return { headers: { authorization: `Bearer ${key}`, ...extra } };
}

describe('/api/v1 door — rate-limit attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('charges nothing for a request without a Bearer header', async () => {
    const { sql, charges } = fakeSql();
    const { auth, getSession } = fakeAuth();
    const res = await door(sql, auth).request('http://localhost/probe', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(res.status).toBe(401);
    expect(charges).toEqual([]);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('charges a failed key to the trusted-proxy client IP, never the leftmost XFF entry', async () => {
    const { sql, charges } = fakeSql();
    const { auth, getSession } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer('tale_bogus', { 'x-forwarded-for': 'evil.spoof, 203.0.113.9' }),
    );
    expect(res.status).toBe(401);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(charges).toEqual([
      { name: 'rest:auth-fail-ip', key: 'ip:203.0.113.9' },
    ]);
  });

  it('keys every attempt the same however the caller rotates the leftmost entry', async () => {
    const { sql, charges } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      await app.request(
        'http://localhost/probe',
        bearer('tale_bogus', { 'x-forwarded-for': `${spoof}, 203.0.113.9` }),
      );
    }
    expect(charges.map((charge) => charge.key)).toEqual([
      'ip:203.0.113.9',
      'ip:203.0.113.9',
      'ip:203.0.113.9',
    ]);
  });

  it('lets an untrusted TCP peer override any forwarded header', async () => {
    const { sql, charges } = fakeSql();
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer('tale_bogus', { 'x-forwarded-for': 'evil.spoof, 203.0.113.9' }),
      { incoming: { socket: { remoteAddress: '198.51.100.77' } } },
    );
    expect(res.status).toBe(401);
    expect(charges).toEqual([
      { name: 'rest:auth-fail-ip', key: 'ip:198.51.100.77' },
    ]);
  });

  it('answers 429 with Retry-After once a source has burned its failure budget', async () => {
    const { sql, charges } = fakeSql(
      new Set(['rest:auth-fail-ip|ip:203.0.113.9']),
    );
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer('tale_bogus', { 'x-forwarded-for': '203.0.113.9' }),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(
      charges.some((charge) => String(charge.key).startsWith('user:')),
    ).toBe(false);
  });

  it('charges an authenticated request to the key holder, not to any IP', async () => {
    const { sql, charges } = fakeSql();
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-forwarded-for': 'evil.spoof, 203.0.113.9' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 'user-1',
      clientIp: '203.0.113.9',
    });
    expect(charges).toEqual([{ name: 'rest:api', key: 'user:user-1' }]);
  });

  it('keeps a key holder within budget even from a source that burned its failure lane', async () => {
    const { sql, charges } = fakeSql(
      new Set(['rest:auth-fail-ip|ip:203.0.113.9']),
    );
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-forwarded-for': '203.0.113.9' }),
    );
    expect(res.status).toBe(200);
    expect(charges).toEqual([{ name: 'rest:api', key: 'user:user-1' }]);
  });

  it('answers 429 when the key holder is over the rest:api budget', async () => {
    const { sql } = fakeSql(new Set(['rest:api|user:user-1']));
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it("surfaces Better Auth's own per-key window as 429, not as an invalid key", async () => {
    const { sql, charges } = fakeSql();
    const { auth } = fakeAuth({
      status: 'TOO_MANY_REQUESTS',
      statusCode: 429,
      message: 'RATE_LIMITED',
    });
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(charges).toEqual([]);
  });

  it('reads any other lookup failure as an invalid key and charges the source', async () => {
    const { sql, charges } = fakeSql();
    const { auth } = fakeAuth(new Error('FORBIDDEN'));
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer('tale_expired', { 'x-real-ip': '198.51.100.7' }),
    );
    expect(res.status).toBe(401);
    expect(charges).toEqual([
      { name: 'rest:auth-fail-ip', key: 'ip:198.51.100.7' },
    ]);
  });
});
