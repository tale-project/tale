// @vitest-environment node

import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../auth/auth.ts';
import type { RestEnv } from './shared.ts';
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
 * UPSERTs nothing and reads back an empty bucket), and records every charge
 * and every statement.
 */
function fakeSql(
  exhausted: Set<string> = new Set(),
  world: {
    /** Organizations by slug (the `X-Organization-Slug` lookup). */
    organizations?: Record<string, { id: string; slug: string }>;
    /** The org ids user-1 is a member of. */
    memberOf?: Set<string>;
    /** An org whose membership is revoked right after its first member-row
     * lookup — the door's re-check then finds none (a concurrent removal). */
    revokeAfterFirstLookup?: string;
    /** Org ids whose organization row carries no slug. */
    slugless?: Set<string>;
    /** Fail every query whose text matches — a database outage. */
    outage?: RegExp;
    /** The binding of a key bound to one organization, by key id
     * (`app.api_key_owners`); a key without one is a person's own. */
    keyOwners?: Record<string, object>;
  } = {},
): {
  sql: Sql;
  charges: Charge[];
  /** Every statement's text, in order, and the values it carried. */
  queries: { text: string; values: unknown[] }[];
} {
  const charges: Charge[] = [];
  const queries: { text: string; values: unknown[] }[] = [];
  const memberOf = new Set(world.memberOf ?? ['org-1']);
  const slugless = world.slugless ?? new Set<string>();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (world.outage?.test(text)) {
      return Promise.reject(new Error('connection refused'));
    }
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
    if (text.includes('FROM app.api_key_owners WHERE api_key_id')) {
      const owner = world.keyOwners?.[String(values[0])];
      return Promise.resolve(owner === undefined ? [] : [owner]);
    }
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve(
        [...memberOf].map((organizationId) => ({
          organizationId,
          role: 'member',
        })),
      );
    }
    if (text.includes('FROM "member" m JOIN "organization" o')) {
      return Promise.resolve(
        [...memberOf].map((organizationId) => ({
          organizationId,
          role: 'member',
          name: `Org ${organizationId}`,
          slug: slugless.has(organizationId) ? null : organizationId,
        })),
      );
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      const [organizationId] = values;
      return Promise.resolve([
        {
          slug: slugless.has(String(organizationId)) ? null : 'acme',
          name: 'Acme',
        },
      ]);
    }
    if (text.includes('FROM "organization" WHERE "slug"')) {
      const [slug] = values;
      const org = world.organizations?.[String(slug)];
      return Promise.resolve(org === undefined ? [] : [org]);
    }
    if (text.includes('FROM "member" WHERE "organizationId"')) {
      const [organizationId] = values;
      const isMember = memberOf.has(String(organizationId));
      if (world.revokeAfterFirstLookup === organizationId) {
        memberOf.delete(String(organizationId));
      }
      return Promise.resolve(
        isMember
          ? [
              {
                id: 'm-1',
                organizationId,
                userId: 'user-1',
                role: 'member',
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, charges, queries };
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
        ? {
            user: { id: 'user-1', email: 'user@example.com' },
            // The api-key plugin names the key row as the session id.
            session: { id: 'key-1' },
          }
        : null,
    );
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { auth: { api: { getSession } } as unknown as Auth, getSession };
}

function door(sql: Sql, auth: Auth) {
  const app = createRestV1Routes({ sql, auth });
  app.get('/probe', (c) =>
    c.json({
      userId: c.get('userId'),
      clientIp: c.get('clientIp'),
      apiKeyId: c.get('apiKeyId'),
    }),
  );
  return app;
}

function bearer(key: string, extra: Record<string, string> = {}) {
  return { headers: { authorization: `Bearer ${key}`, ...extra } };
}

/**
 * RFC 9110: the authentication scheme is case-insensitive (§11.1), and a
 * 401 carries a `WWW-Authenticate` challenge (§11.6.1). The door matched
 * `Bearer ` byte for byte — the same key answered 200 as `Bearer` and 401 as
 * `bearer` — and none of its 401s named the scheme it expected.
 */
describe('/api/v1 door — HTTP authentication conformance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['bearer', 'BEARER', 'Bearer'])(
    'accepts the scheme spelled %s',
    async (scheme) => {
      const { sql } = fakeSql();
      const { auth } = fakeAuth();
      const res = await door(sql, auth).request('http://localhost/probe', {
        headers: { authorization: `${scheme} ${GOOD_KEY}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ userId: 'user-1' });
    },
  );

  it('challenges a request without credentials with the bare Bearer scheme', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const missing = await door(sql, auth).request('http://localhost/probe');
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');
    const empty = await door(sql, auth).request('http://localhost/probe', {
      headers: { authorization: 'Bearer   ' },
    });
    expect(empty.status).toBe(401);
    expect(empty.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('names the refused token on a key that failed to authenticate', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer('tale_bogus'),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('stashes the verified key’s row id for /me — the plugin’s session id — and never a plaintext', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ apiKeyId: 'key-1' });
    expect(JSON.stringify(body)).not.toContain(GOOD_KEY);
  });
});

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
      apiKeyId: 'key-1',
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

/**
 * Org resolution answers the DOMAIN's status. The regression under test: the
 * door wrapped `resolveUserOrganization` in a catch-all that flattened every
 * failure to a 400 with the raw message — a foreign slug (403), an unknown
 * one (404), and a database outage alike, the last with the driver's text on
 * the wire and never reaching error reporting.
 */
describe('/api/v1 door — organization resolution statuses', () => {
  it('answers 403 ORG_FORBIDDEN for a slug the key holder is no member of', async () => {
    const { sql } = fakeSql(new Set(), {
      organizations: { other: { id: 'org-2', slug: 'other' } },
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'other' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('folds the slug header to lowercase — slugs are stored lowercase, so `ACME` names acme', async () => {
    const { sql } = fakeSql(new Set(), {
      organizations: { acme: { id: 'org-1', slug: 'acme' } },
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': ' ACME ' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: 'user-1' });
  });

  it('answers 404 ORG_SLUG_INVALID for an unknown slug', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'nowhere' }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ORG_SLUG_INVALID' });
  });

  it('keeps 400 ORG_SLUG_REQUIRED for a multi-org key that names no org on a write', async () => {
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.post('/probe', (c) => c.json({ ok: true }));
    const res = await app.request('http://localhost/probe', {
      method: 'POST',
      ...bearer(GOOD_KEY),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ORG_SLUG_REQUIRED' });
  });

  it('names the slugs a multi-org key may send in the 400 that asks for one', async () => {
    // `GET /api/v1/me` sits behind the same rule, so without this the
    // refusal was circular: it asked for a slug no call could discover.
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        'Send X-Organization-Slug: the key holder belongs to 2 organizations (org-1, org-2)',
      code: 'ORG_SLUG_REQUIRED',
      data: {
        organizations: [
          { slug: 'org-1', name: 'Org org-1' },
          { slug: 'org-2', name: 'Org org-2' },
        ],
      },
    });
  });

  it('refuses a multi-org key that names no org on a read too — never the dashboard’s last-active org', async () => {
    // A plain GET used to follow the key holder's last-active pointer, so
    // the organization a machine read from depended on what a person had
    // last opened in a browser.
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ORG_SLUG_REQUIRED' });
  });

  it('lets a database outage during resolution reach the error handler, not a 400', async () => {
    const { sql } = fakeSql(new Set(), {
      outage: /FROM "member" WHERE "userId"/,
    });
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.onError((error, c) => c.text(`handled: ${error.message}`, 500));
    const res = await app.request('http://localhost/probe', bearer(GOOD_KEY));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('handled: connection refused');
  });

  it('answers 404 ORG_SLUG_INVALID for a header that cannot be a slug, without looking it up and without echoing it whole', async () => {
    const { sql, queries } = fakeSql();
    const { auth } = fakeAuth();
    const monster = `Not A Slug ${'x'.repeat(500)}`;
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': monster }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('ORG_SLUG_INVALID');
    expect(body.error.length).toBeLessThan(120);
    // The unbounded value never reaches the database — only the caller's
    // own memberships are read, to list them.
    expect(
      queries.some(
        ({ text, values }) =>
          text.includes('FROM "organization" WHERE "slug"') ||
          values.some((value) =>
            String(value).toLowerCase().includes('not a slug'),
          ),
      ),
    ).toBe(false);
  });

  it('echoes a non-ASCII slug as the UTF-8 the caller sent, not byte by byte (2026-09-19, K1-6)', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    // `tälé` as the byte string a header value arrives as: one code unit
    // per UTF-8 byte — which the message used to quote as `tã¤lã©`.
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 't\u00c3\u00a4l\u00c3\u00a9' }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('ORG_SLUG_INVALID');
    expect(body.error).toBe('Organization not found: tälé');
  });
});

/**
 * Every refusal of the organization a key names hands back the slugs the
 * key holder may send, under `data.organizations` — the regression under
 * test: only the 400 for a missing header carried them, so a key holder in
 * several organizations who mistyped a slug (404) or named a foreign one
 * (403) was told what was wrong but not what to send, and `GET /api/v1/me`
 * sits behind the same header.
 */
describe('/api/v1 door — a slug refusal lists the slugs the key holder may send', () => {
  const both = {
    organizations: [
      { slug: 'org-1', name: 'Org org-1' },
      { slug: 'org-2', name: 'Org org-2' },
    ],
  };

  it('lists them in the 404 for a mistyped slug', async () => {
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'org-l' }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Organization not found: org-l',
      code: 'ORG_SLUG_INVALID',
      data: both,
    });
  });

  it('lists them in the 404 for a header that cannot be a slug', async () => {
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'Org 1' }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Organization not found: org 1',
      code: 'ORG_SLUG_INVALID',
      data: both,
    });
  });

  it('lists them in the 403 for an organization the key holder is no member of', async () => {
    const { sql } = fakeSql(new Set(), {
      organizations: { other: { id: 'org-3', slug: 'other' } },
      memberOf: new Set(['org-1', 'org-2']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'other' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Not a member of organization other',
      code: 'ORG_FORBIDDEN',
      data: both,
    });
  });

  it('lists what is left in the 403 for a membership removed while the door resolved it', async () => {
    const { sql } = fakeSql(new Set(), {
      organizations: { acme: { id: 'org-1', slug: 'acme' } },
      memberOf: new Set(['org-1', 'org-2']),
      revokeAfterFirstLookup: 'org-1',
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'acme' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Not a member of organization "acme".',
      code: 'ORG_FORBIDDEN',
      data: { organizations: [{ slug: 'org-2', name: 'Org org-2' }] },
    });
  });

  it('answers an empty list in the 403 for a key holder with no membership', async () => {
    const { sql } = fakeSql(new Set(), { memberOf: new Set() });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'User has no organization memberships',
      code: 'ORG_FORBIDDEN',
      data: { organizations: [] },
    });
  });

  it('offers no slugless organization in the 404 for a sole membership without a slug', async () => {
    // A single membership resolves without the header; the organization it
    // resolves to has no slug to route by, so it is not a choice either.
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1']),
      slugless: new Set(['org-1']),
    });
    const { auth } = fakeAuth();
    const res = await door(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Organization slug not found',
      code: 'ORG_SLUG_INVALID',
      data: { organizations: [] },
    });
  });
});

/**
 * Every non-2xx on this door is the documented flat JSON envelope — the
 * 500 an escaped error answers included. The app-level handler's text/plain
 * `Internal Server Error` broke every client that read the body as JSON,
 * and carried no handle the caller could quote back.
 */
describe('/api/v1 door — escaped errors and response hygiene', () => {
  it('answers a thrown error as a JSON 500 carrying the request id', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.use(async (c, next) => {
      c.set('requestId', 'req-123');
      await next();
    });
    app.get('/boom', () => {
      throw new Error('driver exploded');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request('http://localhost/boom', bearer(GOOD_KEY));
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        requestId: 'req-123',
      });
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('answers a caller that hung up mid-body with an unread 499, unreported', async () => {
    // Node's own abort of a body read, with the signal the adapter aborts
    // as the socket closes; a closed tab mid-upload used to be a reported
    // 500.
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.post('/upload', () => {
      throw Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    });
    const gone = new AbortController();
    gone.abort('Error: aborted');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const res = await app.request(
        new Request('http://localhost/upload', {
          method: 'POST',
          ...bearer(GOOD_KEY),
          signal: gone.signal,
        }),
      );
      expect(res.status).toBe(499);
      expect(await res.text()).toBe('');
      expect(errors).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(
        '[backend] client closed the request — 499 for POST /upload',
      );
    } finally {
      errors.mockRestore();
      debug.mockRestore();
    }
  });

  it('still reports the same error while the caller is there — an outbound read cut short', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.get('/download', () => {
      throw Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        'http://localhost/download',
        bearer(GOOD_KEY),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('turns a thrown HTTPException into the envelope with its own status', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.get('/huge', () => {
      throw new HTTPException(413, { message: 'Payload Too Large' });
    });
    const res = await app.request('http://localhost/huge', bearer(GOOD_KEY));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'Payload Too Large',
      code: 'BODY_TOO_LARGE',
    });
  });

  it('marks every response uncacheable unless the route chose a directive', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.get('/blob', (c) =>
      c.body('bytes', 200, { 'cache-control': 'private, no-store' }),
    );
    const probe = await app.request('http://localhost/probe', bearer(GOOD_KEY));
    expect(probe.headers.get('cache-control')).toBe('no-store');
    const refused = await app.request('http://localhost/probe');
    expect(refused.status).toBe(401);
    expect(refused.headers.get('cache-control')).toBe('no-store');
    const blob = await app.request('http://localhost/blob', bearer(GOOD_KEY));
    expect(blob.headers.get('cache-control')).toBe('private, no-store');
  });
});

/**
 * A database restart is neither a bad key nor a defect. The door answers the
 * retryable 503 `DATABASE_UNAVAILABLE` with `Retry-After`, unreported, where
 * a key lookup the database could not serve read as an invalid key (401 —
 * "stop using this key") and an escaped outage as a reported 500.
 */
describe('/api/v1 door — an unavailable database', () => {
  it('answers a key lookup the database could not serve with a 503, not a 401', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, charges } = fakeSql();
    // Better Auth's pool is node-postgres: a refused socket, nothing more.
    const refused = Object.assign(
      new Error('connect ECONNREFUSED 10.0.0.5:5432'),
      { code: 'ECONNREFUSED' },
    );
    const { auth } = fakeAuth(refused);
    try {
      const res = await door(sql, auth).request(
        'http://localhost/probe',
        bearer(GOOD_KEY),
      );
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(await res.json()).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
      // Nobody's source address is charged a failed authentication.
      expect(charges).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('answers an escaped outage with an unreported 503 that carries the request id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const app = door(sql, auth);
    app.use(async (c, next) => {
      c.set('requestId', 'req-503');
      await next();
    });
    app.get('/restart', () => {
      throw Object.assign(
        new Error('terminating connection due to administrator command'),
        { code: '57P01' },
      );
    });
    try {
      const res = await app.request(
        'http://localhost/restart',
        bearer(GOOD_KEY),
      );
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        error:
          'The platform’s database is not answering right now — it may be restarting; retry with backoff',
        code: 'DATABASE_UNAVAILABLE',
        requestId: 'req-503',
      });
      // `reportRequestError` logs every report it makes; none was made.
      expect(errors).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[backend] database unavailable — 503 for GET /restart: 57P01 terminating connection due to administrator command',
      );
    } finally {
      warn.mockRestore();
      errors.mockRestore();
    }
  });
});

/**
 * A write takes no query parameters on this door — except on the model
 * endpoints, whose vendor SDKs add their own (`POST /v1/messages?beta=true`
 * from an Anthropic SDK): the door reads none there and relays none.
 */
describe('/api/v1 door — query parameters on writes', () => {
  function writeDoor(sql: Sql, auth: Auth) {
    const app = createRestV1Routes({ sql, auth });
    app.post('/anthropic/probe', (c) => c.json({ ok: true }));
    app.post('/openai/probe', (c) => c.json({ ok: true }));
    app.post('/probe', (c) => c.json({ ok: true }));
    return app;
  }

  it('refuses a query on an ordinary write', async () => {
    const { sql } = fakeSql();
    const { auth } = fakeAuth();
    const res = await writeDoor(sql, auth).request(
      'http://localhost/probe?beta=true',
      { method: 'POST', ...bearer(GOOD_KEY) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it.each(['/anthropic/probe?beta=true', '/openai/probe?api-version=1'])(
    'lets the vendor wire’s own query through on %s',
    async (path) => {
      const { sql } = fakeSql();
      const { auth } = fakeAuth();
      const res = await writeDoor(sql, auth).request(
        `http://localhost${path}`,
        {
          method: 'POST',
          ...bearer(GOOD_KEY),
        },
      );
      expect(res.status).toBe(200);
    },
  );
});

/**
 * A key an Owner or Admin bound to ONE organization — made for a member, or
 * a team's, a project's or the organization's own — works there alone,
 * with no `X-Organization-Slug` needed, and with the role its binding
 * gives it. A project's key reaches its own project and nothing else.
 */
describe('/api/v1 door — a key bound to one organization', () => {
  function binding(
    kind: 'member' | 'team' | 'project' | 'organization',
    extra: Record<string, unknown> = {},
  ) {
    return {
      apiKeyId: 'key-1',
      organizationId: 'org-1',
      kind,
      principalUserId: 'user-1',
      teamId: kind === 'team' ? 'team-1' : null,
      projectId: kind === 'project' ? 'project-1' : null,
      role: kind === 'member' ? null : 'editor',
      name: 'Sync key',
      createdBy: 'admin-1',
      createdAt: '1',
      revokedAt: null,
      revokedBy: null,
      ...extra,
    };
  }
  function boundDoor(sql: Sql, auth: Auth) {
    const app = createRestV1Routes({ sql, auth });
    const probe = (c: Context<RestEnv>) =>
      c.json({
        organizationId: c.get('organizationId'),
        orgSlug: c.get('orgSlug'),
        role: c.get('role'),
        userEmail: c.get('userEmail'),
        owner: c.get('apiKeyOwner')?.kind ?? null,
      });
    // Paths no route of the door serves, so the probe answers whatever the
    // door let through; which real routes a project's key reaches is
    // `api-key-scope.test.ts`'s matrix.
    app.get('/probe', probe);
    app.get('/projects/:projectId/probe', probe);
    return app;
  }

  it('works in its organization with no slug header, acting with the role it was made with [APIKEY-R5]', async () => {
    const { sql } = fakeSql(new Set(), {
      // Were the person's memberships read, two would ask for a slug.
      memberOf: new Set(['org-1', 'org-2']),
      keyOwners: { 'key-1': binding('organization') },
    });
    const { auth } = fakeAuth();
    const res = await boundDoor(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: 'org-1',
      orgSlug: 'acme',
      role: 'editor',
      // A key that is not a person has no address of its own.
      userEmail: '',
      owner: 'organization',
    });
  });

  it('refuses a slug header naming another organization, listing its own [APIKEY-R5]', async () => {
    const { sql } = fakeSql(new Set(), {
      memberOf: new Set(['org-1', 'org-2']),
      keyOwners: { 'key-1': binding('team') },
    });
    const { auth } = fakeAuth();
    const res = await boundDoor(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'org-2' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'This key works only in organization "acme".',
      code: 'ORG_FORBIDDEN',
      data: { organizations: [{ slug: 'acme', name: 'Acme' }] },
    });
    // Its own slug, in any case, is accepted.
    const own = await boundDoor(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY, { 'x-organization-slug': 'ACME' }),
    );
    expect(own.status).toBe(200);
  });

  it('acts with a member’s live role, and stops once they left [APIKEY-R2]', async () => {
    const { auth } = fakeAuth();
    const staying = fakeSql(new Set(), {
      keyOwners: { 'key-1': binding('member') },
    });
    const res = await boundDoor(staying.sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      role: 'member',
      userEmail: 'user@example.com',
      owner: 'member',
    });

    const gone = fakeSql(new Set(), {
      memberOf: new Set(['org-2']),
      keyOwners: { 'key-1': binding('member') },
    });
    const refused = await boundDoor(gone.sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('answers 401 for a binding that was revoked [APIKEY-R7]', async () => {
    const { sql } = fakeSql(new Set(), {
      keyOwners: { 'key-1': binding('team', { revokedAt: '5' }) },
    });
    const { auth } = fakeAuth();
    const res = await boundDoor(sql, auth).request(
      'http://localhost/probe',
      bearer(GOOD_KEY),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('lets a project’s key reach its own project and nothing else [APIKEY-R6]', async () => {
    const { sql } = fakeSql(new Set(), {
      keyOwners: { 'key-1': binding('project') },
    });
    const { auth } = fakeAuth();
    const app = boundDoor(sql, auth);
    const get = (path: string) =>
      app.request(`http://localhost${path}`, bearer(GOOD_KEY));
    expect((await get('/projects/project-1/probe')).status).toBe(200);
    for (const path of ['/probe', '/projects/project-2/probe']) {
      const res = await get(path);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'This key belongs to one project and reaches only that project.',
        code: 'API_KEY_SCOPE_FORBIDDEN',
      });
    }
  });
});
