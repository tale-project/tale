// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSessionCookie } from '../../core/enterprise_sso/login/finish_login.ts';
import { signCookieValue } from '../../core/enterprise_sso/sign_cookie_value.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { checkIpRateLimit } from '../../lib/rate-limit.ts';
import { resolveTrustedHeaderKey } from '../trusted_headers/service.ts';
import { syncTeamsFromGroupNames } from './service.ts';
import {
  createTrustedHeadersRoutes,
  framingHeaders,
  presentedTrustedHeaderKey,
  trustedHeadersAuthenticate,
  TrustedHeadersRefusedError,
} from './trusted-headers.ts';

/**
 * The organization-mode door: the presented key decides the organization
 * (and whether anything happens at all), the identity headers decide the
 * person, the ceiling decides the role, and the org-binding contract
 * decides who may be signed in — an existing member yes, a user new to the
 * deployment yes (created inside this organization), a stranger never.
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

/** What `createAuditLog` needs back from an empty chain — the door audits
 * every sign-in and every JIT join. */
function auditChainAnswers(text: string): object[] | undefined {
  if (text.startsWith('SELECT last_hash AS "lastHash"')) {
    return [{ lastHash: '', lastTs: 0 }];
  }
  if (text.startsWith('INSERT INTO app.audit_logs')) return [{ id: 'audit-1' }];
  return undefined;
}

/** Tagged-template Sql double: answers by SQL-text pattern, records calls. */
function fakeSql(script: { match: RegExp; rows: object[] }[]): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    const chain = auditChainAnswers(text);
    if (chain !== undefined) return Promise.resolve(chain);
    const hit = script.find((entry) => entry.match.test(text));
    return Promise.resolve(hit?.rows ?? []);
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

const writes = (queries: Captured[]): Captured[] =>
  queries.filter(
    (q) =>
      (q.text.startsWith('INSERT') ||
        q.text.startsWith('UPDATE') ||
        q.text.startsWith('DELETE')) &&
      !q.text.startsWith('INSERT INTO app.audit_logs'),
  );

/** Existing member of org-1, no reusable session. */
function memberScript(): { match: RegExp; rows: object[] }[] {
  return [
    {
      match: /SELECT "id", "name" FROM "user"/,
      rows: [{ id: 'user-1', name: 'Proxy User' }],
    },
    {
      match: /SELECT "role" FROM "member"/,
      rows: [{ role: 'member' }],
    },
    { match: /SELECT .* FROM "session"/, rows: [] },
    { match: /INSERT INTO "session"/, rows: [] },
  ];
}

/** A user the deployment has never seen. */
function newUserScript(): { match: RegExp; rows: object[] }[] {
  return [
    { match: /SELECT "id", "name" FROM "user"/, rows: [] },
    { match: /INSERT INTO "user"/, rows: [{ id: 'user-new' }] },
    { match: /INSERT INTO "member"/, rows: [] },
    { match: /INSERT INTO "session"/, rows: [] },
  ];
}

/** An existing user with NO membership in org-1. */
function strangerScript(): { match: RegExp; rows: object[] }[] {
  return [
    {
      match: /SELECT "id", "name" FROM "user"/,
      rows: [{ id: 'user-elsewhere', name: 'Some One' }],
    },
    { match: /SELECT "role" FROM "member"/, rows: [] },
  ];
}

const ENV_KEYS = [
  'BETTER_AUTH_SECRET',
  'SITE_URL',
  'TRUSTED_SECRET_HEADER',
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.BETTER_AUTH_SECRET = 'session-signing-secret';
  delete process.env.SITE_URL;
  delete process.env.TRUSTED_SECRET_HEADER;
  vi.mocked(resolveTrustedHeaderKey).mockReset().mockResolvedValue({
    keyId: 'key-1',
    organizationId: 'org-1',
    enabled: true,
    maxAssertedRole: 'admin',
  });
  vi.mocked(checkIpRateLimit).mockReset().mockResolvedValue(undefined);
  vi.mocked(syncTeamsFromGroupNames).mockClear();
  vi.mocked(readGovernancePolicyForOrg).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const baseArgs = {
  organizationId: 'org-1',
  keyId: 'key-1',
  email: 'proxy.user@door.test',
  name: 'Proxy User',
  role: 'member' as const,
  teams: null,
};

describe('framingHeaders — what a door answer may be framed by', () => {
  it('denies every ancestor without origins, and names them with', () => {
    expect(framingHeaders([])).toEqual({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    });
    expect(framingHeaders(['https://app.example'])).toEqual({
      'Content-Security-Policy': "frame-ancestors 'self' https://app.example",
    });
  });
});

describe('presentedTrustedHeaderKey — where the key rides', () => {
  it('prefers a bearer Authorization over the key header', () => {
    expect(presentedTrustedHeaderKey('Bearer thk_a', 'thk_b')).toBe('thk_a');
    expect(presentedTrustedHeaderKey('bearer   thk_a  ', undefined)).toBe(
      'thk_a',
    );
  });

  it('falls back to the key header, and reads empty as absent', () => {
    expect(presentedTrustedHeaderKey(undefined, ' thk_b ')).toBe('thk_b');
    expect(presentedTrustedHeaderKey('Basic xyz', 'thk_b')).toBe('thk_b');
    expect(presentedTrustedHeaderKey(undefined, '')).toBeUndefined();
    expect(presentedTrustedHeaderKey('Bearer ', undefined)).toBeUndefined();
    expect(presentedTrustedHeaderKey(undefined, undefined)).toBeUndefined();
  });
});

describe('trustedHeadersAuthenticate — the org-binding contract', () => {
  it('signs an existing member into the key’s organization and stamps role + organization on the session', async () => {
    const { sql, queries } = fakeSql(memberScript());

    const result = await trustedHeadersAuthenticate(sql, baseArgs);

    expect(result).toMatchObject({
      userId: 'user-1',
      organizationId: 'org-1',
      isNewUser: false,
      role: 'member',
    });
    const membership = queries.find((q) =>
      q.text.startsWith('SELECT "role" FROM "member"'),
    );
    expect(membership?.values).toEqual(['user-1', 'org-1']);
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO "session"'),
    );
    expect(insert?.text).toContain('"trustedOrganizationId"');
    expect(insert?.text).toContain('"activeOrganizationId"');
    expect(insert?.values).toEqual(
      expect.arrayContaining([
        result.sessionToken,
        'user-1',
        'member',
        'org-1',
      ]),
    );
    expect(queries.some((q) => q.text.startsWith('INSERT INTO "user"'))).toBe(
      false,
    );
  });

  it('creates a user new to the deployment INSIDE the organization, with the clamped role', async () => {
    const { sql, queries } = fakeSql(newUserScript());

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      role: 'developer',
    });

    expect(result.isNewUser).toBe(true);
    expect(result.userId).toBe('user-new');
    const user = queries.find((q) => q.text.startsWith('INSERT INTO "user"'));
    expect(user?.values).toEqual(
      expect.arrayContaining(['proxy.user@door.test', 'Proxy User']),
    );
    const member = queries.find((q) =>
      q.text.startsWith('INSERT INTO "member"'),
    );
    expect(member?.values).toEqual(
      expect.arrayContaining(['org-1', 'user-new', 'developer']),
    );
    // The door never founds an organization of its own any more.
    expect(
      queries.some((q) => q.text.includes('INSERT INTO "organization"')),
    ).toBe(false);
    const audits = queries
      .filter((q) => q.text.startsWith('INSERT INTO app.audit_logs'))
      .flatMap((q) => q.values);
    expect(audits).toContain('joined_organization');
    expect(audits).toContain('trusted_headers_sign_in');
  });

  it('refuses an existing user who is not a member of the organization, before any write', async () => {
    const { sql, queries } = fakeSql(strangerScript());

    await expect(
      trustedHeadersAuthenticate(sql, baseArgs),
    ).rejects.toBeInstanceOf(TrustedHeadersRefusedError);
    expect(writes(queries)).toHaveLength(0);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO app.audit_logs')),
    ).toBe(false);
    expect(syncTeamsFromGroupNames).not.toHaveBeenCalled();
  });

  it('syncs the asserted teams into the organization after the transaction, and leaves teams alone without a header', async () => {
    const { sql } = fakeSql(memberScript());

    await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      teams: [
        { id: 't-fin', name: 'Finance' },
        { id: 't-ops', name: 'Operations' },
      ],
    });
    expect(syncTeamsFromGroupNames).toHaveBeenCalledWith(sql, {
      userId: 'user-1',
      organizationId: 'org-1',
      groupNames: ['Finance', 'Operations'],
      excludeGroups: [],
    });

    vi.mocked(syncTeamsFromGroupNames).mockClear();
    await trustedHeadersAuthenticate(fakeSql(memberScript()).sql, baseArgs);
    expect(syncTeamsFromGroupNames).not.toHaveBeenCalled();
  });

  it("refreshes the cookie's own live session instead of minting, rebinding it to this organization", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { sql, queries } = fakeSql([
      ...memberScript().filter((entry) => !/session/.test(entry.match.source)),
      {
        match: /SELECT "id", "userId", "token", "expiresAt" FROM "session"/,
        rows: [
          { id: 'sess-1', userId: 'user-1', token: 'tok-1', expiresAt: future },
        ],
      },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      role: 'admin',
      existingSessionToken: 'tok-1',
    });

    expect(result.sessionToken).toBe('tok-1');
    const update = queries.find((q) => q.text.startsWith('UPDATE "session"'));
    expect(update?.text).toContain('"trustedOrganizationId" = $?');
    expect(update?.values).toEqual(
      expect.arrayContaining(['admin', 'org-1', 'sess-1']),
    );
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(false);
  });

  it("kills another user's session on an account switch and mints afresh", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { sql, queries } = fakeSql([
      ...memberScript().filter((entry) => !/session/.test(entry.match.source)),
      {
        match: /SELECT "id", "userId", "token", "expiresAt" FROM "session"/,
        rows: [
          {
            id: 'sess-other',
            userId: 'user-other',
            token: 'tok-other',
            expiresAt: future,
          },
        ],
      },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      existingSessionToken: 'tok-other',
    });

    expect(result.sessionToken).not.toBe('tok-other');
    expect(
      queries.find((q) => q.text.startsWith('DELETE FROM "session"'))?.values,
    ).toEqual(['sess-other']);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
  });
});

describe('GET /api/trusted-headers/authenticate — the hand-off door', () => {
  const origin = 'http://backend-api:3005';

  function makeApp(script: { match: RegExp; rows: object[] }[]) {
    const { sql, queries } = fakeSql(script);
    return { app: createTrustedHeadersRoutes({ sql }), queries };
  }

  async function request(
    app: ReturnType<typeof createTrustedHeadersRoutes>,
    headers: Record<string, string>,
  ): Promise<Response> {
    return app.request(`${origin}/authenticate`, { headers });
  }

  const identity = {
    'Remote-Email': 'proxy.user@door.test',
    'Remote-Name': 'Proxy User',
    'Remote-Role': 'member',
  };
  const withKey = { ...identity, authorization: 'Bearer thk_live' };

  it('mints nothing when no key is presented, and never asks the database', async () => {
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, identity);

    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Missing trusted-header key');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(resolveTrustedHeaderKey).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it('charges an unknown key to the source IP and answers 401', async () => {
    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue(null);
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, {
      ...withKey,
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid or revoked trusted-header key');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(checkIpRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'trusted-headers:auth-fail-ip',
      '203.0.113.9',
    );
    expect(queries).toHaveLength(0);
  });

  it('answers 429 once the source IP is over its failure budget', async () => {
    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue(null);
    const { RateLimitExceededError } = await import('../../lib/rate-limit.ts');
    vi.mocked(checkIpRateLimit).mockRejectedValue(
      new RateLimitExceededError('over', 30_000),
    );
    const { app } = makeApp(memberScript());

    const res = await request(app, withKey);

    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Too many failed attempts');
  });

  it('refuses a live key of a paused organization', async () => {
    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue({
      keyId: 'key-1',
      organizationId: 'org-1',
      enabled: false,
      maxAssertedRole: 'admin',
    });
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, withKey);

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('disabled for this organization');
    expect(queries).toHaveLength(0);
  });

  it('refuses a key without an email header', async () => {
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, { authorization: 'Bearer thk_live' });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Missing required header: Remote-Email');
    expect(queries).toHaveLength(0);
  });

  it('sets the session cookie for an existing member and reads the key from the bearer header', async () => {
    const { app } = makeApp(memberScript());

    const res = await request(app, withKey);

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(
      'better-auth.session_token=',
    );
    expect(await res.text()).toContain('url=/dashboard');
    expect(resolveTrustedHeaderKey).toHaveBeenCalledWith(
      expect.anything(),
      'thk_live',
    );
  });

  it('accepts the key in the configurable key header too', async () => {
    process.env.TRUSTED_SECRET_HEADER = 'X-App-Key';
    const { app } = makeApp(memberScript());

    const res = await request(app, { ...identity, 'X-App-Key': 'thk_live' });

    expect(res.status).toBe(200);
    expect(resolveTrustedHeaderKey).toHaveBeenCalledWith(
      expect.anything(),
      'thk_live',
    );
  });

  it("clamps the asserted role to the organization's ceiling", async () => {
    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue({
      keyId: 'key-1',
      organizationId: 'org-1',
      enabled: true,
      maxAssertedRole: 'editor',
    });
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, { ...withKey, 'Remote-Role': 'admin' });

    expect(res.status).toBe(200);
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO "session"'),
    );
    expect(insert?.values).toContain('editor');
    expect(insert?.values).not.toContain('admin');
  });

  it('answers 403 for a stranger, with no session and no write', async () => {
    const { app, queries } = makeApp(strangerScript());

    const res = await request(app, withKey);

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('not a member of the organization');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(writes(queries)).toHaveLength(0);
  });

  it("looks the cookie's session up by its bare token, not the signed cookie value", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { app, queries } = makeApp([
      ...memberScript().filter((entry) => !/session/.test(entry.match.source)),
      {
        match: /SELECT "id", "userId", "token", "expiresAt" FROM "session"/,
        rows: [
          { id: 'sess-1', userId: 'user-1', token: 'tok-1', expiresAt: future },
        ],
      },
    ]);
    const setCookie = await buildSessionCookie(
      'tok-1',
      origin,
      'session-signing-secret',
    );
    const cookie = setCookie.split(';')[0] ?? '';

    const res = await request(app, { ...withKey, cookie });

    expect(res.status).toBe(200);
    const lookup = queries.find((q) =>
      q.text.startsWith(
        'SELECT "id", "userId", "token", "expiresAt" FROM "session"',
      ),
    );
    expect(lookup?.values).toEqual(['tok-1']);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(false);
  });

  it('treats a cookie that fails verification as no cookie at all', async () => {
    const { app, queries } = makeApp(memberScript());
    const forged = `better-auth.session_token=${await signCookieValue('tok-1', 'another-secret')}`;

    const res = await request(app, { ...withKey, cookie: forged });

    expect(res.status).toBe(200);
    expect(
      queries.some((q) =>
        q.text.startsWith(
          'SELECT "id", "userId", "token", "expiresAt" FROM "session"',
        ),
      ),
    ).toBe(false);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
  });

  it('refuses every frame ancestor unless the organization embeds', async () => {
    const { app } = makeApp(memberScript());

    const noKey = await request(app, identity);
    expect(noKey.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(noKey.headers.get('x-frame-options')).toBe('DENY');

    const signedIn = await request(app, withKey);
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(signedIn.headers.get('x-frame-options')).toBe('DENY');
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'embedding',
    );
  });

  it("admits the organization's embedding origins on its answers, refusals included", async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      enabled: true,
      frameAncestors: ['https://portal.example', 'https://app.example'],
    });
    const { app } = makeApp(memberScript());

    const signedIn = await request(app, withKey);
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://app.example https://portal.example",
    );
    expect(signedIn.headers.get('x-frame-options')).toBeNull();

    const stranger = await request(makeApp(strangerScript()).app, withKey);
    expect(stranger.status).toBe(403);
    expect(stranger.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://app.example https://portal.example",
    );
    expect(stranger.headers.get('x-frame-options')).toBeNull();
  });

  it('keeps a disabled embedding policy and an unknown key on DENY', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      enabled: false,
      frameAncestors: ['https://portal.example'],
    });
    const { app } = makeApp(memberScript());
    const signedIn = await request(app, withKey);
    expect(signedIn.headers.get('x-frame-options')).toBe('DENY');

    vi.mocked(resolveTrustedHeaderKey).mockResolvedValue(null);
    const unknown = await request(makeApp(memberScript()).app, withKey);
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get('x-frame-options')).toBe('DENY');
    expect(readGovernancePolicyForOrg).toHaveBeenCalledTimes(1);
  });

  it('answers a server configuration error without the signing secret', async () => {
    delete process.env.BETTER_AUTH_SECRET;
    const { app, queries } = makeApp(memberScript());

    const res = await request(app, withKey);

    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Server configuration error');
    expect(writes(queries)).toHaveLength(0);
  });
});
