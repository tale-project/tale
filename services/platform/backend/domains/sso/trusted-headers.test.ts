// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signCookieValue } from '../../core/enterprise_sso/sign_cookie_value.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  createTrustedHeadersRoutes,
  trustedHeadersAuthenticate,
} from './trusted-headers.ts';

/**
 * The spoofing guard: the endpoint mints a session as whoever `Remote-Email`
 * names, so the ONLY thing separating "came through the authenticating
 * proxy" from "reached the backend directly" is the internal secret the
 * proxy injects. The regression under test: the route used to pass
 * `process.env.TRUSTED_HEADERS_INTERNAL_SECRET` as the caller value, so the
 * service compared the env secret against itself and never failed.
 */

interface Captured {
  text: string;
  values: unknown[];
}

/** Tagged-template Sql double: answers by SQL-text pattern, records calls. */
function fakeSql(script: { match: RegExp; rows: object[] }[]): {
  sql: Sql;
  queries: Captured[];
  beginCalls: () => number;
} {
  const queries: Captured[] = [];
  let begins = 0;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    const hit = script.find((entry) => entry.match.test(text));
    return Promise.resolve(hit?.rows ?? []);
  };
  const begin = async (cb: (tx: unknown) => Promise<unknown>) => {
    begins += 1;
    return cb(tag);
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    sql: Object.assign(tag, { begin }) as unknown as Sql,
    queries,
    beginCalls: () => begins,
  };
}

/** Happy-path script: existing user, one membership, no reusable session. */
function happyScript(): { match: RegExp; rows: object[] }[] {
  return [
    {
      match: /SELECT "id", "name" FROM "user"/,
      rows: [{ id: 'user-1', name: 'Proxy User' }],
    },
    {
      match: /SELECT "organizationId" FROM "member"/,
      rows: [{ organizationId: 'org-1' }],
    },
    { match: /SELECT .* FROM "session"/, rows: [] },
    { match: /INSERT INTO "session"/, rows: [] },
  ];
}

const ENV_KEYS = [
  'TRUSTED_HEADERS_INTERNAL_SECRET',
  'TRUSTED_HEADERS_ENABLED',
  'TRUSTED_SECRET_HEADER',
  'BETTER_AUTH_SECRET',
  'SITE_URL',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const baseArgs = {
  email: 'proxy.user@door.test',
  name: 'Proxy User',
  role: 'member',
  teams: null,
};

describe('trustedHeadersAuthenticate — internal-secret guard', () => {
  it('refuses when TRUSTED_HEADERS_INTERNAL_SECRET is not configured', async () => {
    delete process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
    const { sql, beginCalls } = fakeSql(happyScript());

    await expect(
      trustedHeadersAuthenticate(sql, { ...baseArgs, secret: 'anything' }),
    ).rejects.toThrow(/TRUSTED_HEADERS_INTERNAL_SECRET is not configured/);
    // Fails closed BEFORE touching the database.
    expect(beginCalls()).toBe(0);
  });

  it('refuses a wrong caller-supplied secret', async () => {
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'right-secret';
    const { sql, beginCalls } = fakeSql(happyScript());

    await expect(
      trustedHeadersAuthenticate(sql, { ...baseArgs, secret: 'wrong-secret' }),
    ).rejects.toThrow(/Invalid internal secret/);
    expect(beginCalls()).toBe(0);
  });

  it('refuses a missing caller-supplied secret even when the env is set', async () => {
    // THE regression: the old call site passed the env value as the caller
    // value, so this comparison could never fail.
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'right-secret';
    const { sql, beginCalls } = fakeSql(happyScript());

    await expect(
      trustedHeadersAuthenticate(sql, { ...baseArgs, secret: undefined }),
    ).rejects.toThrow(/Invalid internal secret/);
    expect(beginCalls()).toBe(0);
  });

  it('authenticates when the caller supplies the matching secret', async () => {
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'right-secret';
    const { sql, queries } = fakeSql(happyScript());

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      secret: 'right-secret',
    });

    expect(result.userId).toBe('user-1');
    expect(result.organizationId).toBe('org-1');
    expect(result.sessionToken).not.toBe('');
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
  });
});

describe('GET /api/trusted-headers/authenticate — the proxy hand-off door', () => {
  function makeApp(script: { match: RegExp; rows: object[] }[]) {
    const { sql, queries } = fakeSql(script);
    return { app: createTrustedHeadersRoutes({ sql }), queries };
  }

  async function request(
    app: ReturnType<typeof createTrustedHeadersRoutes>,
    headers: Record<string, string>,
  ): Promise<Response> {
    return app.request('http://backend-api:3005/authenticate', { headers });
  }

  const identityHeaders = {
    'Remote-Email': 'proxy.user@door.test',
    'Remote-Name': 'Proxy User',
    'Remote-Role': 'member',
  };

  beforeEach(() => {
    process.env.TRUSTED_HEADERS_ENABLED = 'true';
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'door-secret';
    process.env.BETTER_AUTH_SECRET = 'session-signing-secret';
    delete process.env.TRUSTED_SECRET_HEADER;
    delete process.env.SITE_URL;
  });

  it('mints no session when the secret header is missing', async () => {
    const { app, queries } = makeApp(happyScript());

    const res = await request(app, identityHeaders);

    expect(await res.text()).toContain(
      'Missing required header: Remote-Internal-Secret',
    );
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('mints no session when the secret header is wrong', async () => {
    const { app, queries } = makeApp(happyScript());

    const res = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'not-the-secret',
    });

    expect(await res.text()).toContain('Failed to complete login');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('refuses to run when enabled without a configured secret', async () => {
    delete process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
    const { app, queries } = makeApp(happyScript());

    const res = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'anything',
    });

    expect(await res.text()).toContain('Server configuration error');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('sets the session cookie when the proxy supplies the right secret', async () => {
    const { app } = makeApp(happyScript());

    const res = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'door-secret',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(
      'better-auth.session_token=',
    );
  });

  it('honours a custom TRUSTED_SECRET_HEADER name', async () => {
    process.env.TRUSTED_SECRET_HEADER = 'X-Proxy-Secret';
    const { app } = makeApp(happyScript());

    const missing = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'door-secret',
    });
    expect(await missing.text()).toContain(
      'Missing required header: X-Proxy-Secret',
    );

    const ok = await request(app, {
      ...identityHeaders,
      'X-Proxy-Secret': 'door-secret',
    });
    expect(ok.headers.get('set-cookie')).toContain(
      'better-auth.session_token=',
    );
  });

  // The cookie carries `${token}.${signature}` (signCookieValue's output),
  // the row stores the bare token. The regression: the route matched the
  // signed string against the token column, which never hit — the reuse and
  // account-switch branches were dead and every request fell through to
  // adopting an arbitrary session row of the user.
  it("looks the cookie's session up by its bare token, not the signed cookie value", async () => {
    const signed = await signCookieValue('tok-1', 'session-signing-secret');
    const live = {
      id: 's-1',
      userId: 'user-1',
      token: 'tok-1',
      expiresAt: new Date(Date.now() + 3_600_000),
      trustedRole: 'member',
      trustedTeams: null,
    };
    const { app, queries } = makeApp([
      {
        match: /SELECT "id", "name" FROM "user"/,
        rows: [{ id: 'user-1', name: 'Proxy User' }],
      },
      {
        match: /SELECT "organizationId" FROM "member"/,
        rows: [{ organizationId: 'org-1' }],
      },
      { match: /FROM "session" WHERE "token"/, rows: [live] },
      { match: /SELECT .* FROM "session"/, rows: [] },
    ]);

    const res = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'door-secret',
      cookie: `better-auth.session_token=${signed}`,
    });

    const lookup = queries.find((q) =>
      /FROM "session" WHERE "token"/.test(q.text),
    );
    expect(lookup?.values).toContain('tok-1');
    expect(lookup?.values).not.toContain(decodeURIComponent(signed));
    // The browser's own session is refreshed and handed back — no new row.
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(false);
    expect(res.headers.get('set-cookie')).toContain(
      `better-auth.session_token=${signed}`,
    );
  });

  it('treats a cookie that fails verification as no cookie at all', async () => {
    const { app, queries } = makeApp(happyScript());

    const res = await request(app, {
      ...identityHeaders,
      'Remote-Internal-Secret': 'door-secret',
      cookie: 'better-auth.session_token=tok-1.forged-signature',
    });

    expect(queries.some((q) => /WHERE "token"/.test(q.text))).toBe(false);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
    expect(res.headers.get('set-cookie')).toContain(
      'better-auth.session_token=',
    );
  });
});

/**
 * Session reuse is bound to the browser's OWN cookie. The fallback that
 * adopted "any session row of this user" silently shared one session across
 * devices (signing out or revoking one killed both; the sessions list showed
 * one device) — it is gone.
 */
describe("trustedHeadersAuthenticate — reuse is bound to the browser's own session", () => {
  beforeEach(() => {
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'right-secret';
  });

  const identity = [
    {
      match: /SELECT "id", "name" FROM "user"/,
      rows: [{ id: 'user-1', name: 'Proxy User' }],
    },
    {
      match: /SELECT "organizationId" FROM "member"/,
      rows: [{ organizationId: 'org-1' }],
    },
  ];

  it("never adopts another device's session for the same user", async () => {
    const otherDevice = {
      id: 's-other',
      token: 'other-device-token',
      expiresAt: new Date(Date.now() + 3_600_000),
      trustedRole: 'member',
      trustedTeams: null,
    };
    const { sql, queries } = fakeSql([
      ...identity,
      // The old fallback read `FROM "session" WHERE "userId" … LIMIT 1` —
      // answer it with the other device's live row.
      { match: /FROM "session" WHERE "userId"/, rows: [otherDevice] },
      { match: /SELECT .* FROM "session"/, rows: [] },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      secret: 'right-secret',
    });

    expect(result.sessionToken).not.toBe('other-device-token');
    expect(
      queries.some((q) => /FROM "session" WHERE "userId"/.test(q.text)),
    ).toBe(false);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
  });

  it("refreshes the cookie's own live session and answers its token", async () => {
    const { sql, queries } = fakeSql([
      ...identity,
      {
        match: /FROM "session" WHERE "token"/,
        rows: [
          {
            id: 's-1',
            userId: 'user-1',
            token: 'tok-1',
            expiresAt: new Date(Date.now() + 3_600_000),
            trustedRole: 'member',
            trustedTeams: null,
          },
        ],
      },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      role: 'admin',
      secret: 'right-secret',
      existingSessionToken: 'tok-1',
    });

    expect(result.sessionToken).toBe('tok-1');
    expect(result.trustedHeadersChanged).toBe(true);
    const refresh = queries.find((q) => q.text.startsWith('UPDATE "session"'));
    expect(refresh?.values).toContain('admin');
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(false);
  });

  it("kills the other user's session on an account switch behind the proxy", async () => {
    const { sql, queries } = fakeSql([
      ...identity,
      {
        match: /FROM "session" WHERE "token"/,
        rows: [
          {
            id: 's-2',
            userId: 'user-2',
            token: 'tok-2',
            expiresAt: new Date(Date.now() + 3_600_000),
            trustedRole: 'member',
            trustedTeams: null,
          },
        ],
      },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      secret: 'right-secret',
      existingSessionToken: 'tok-2',
    });

    expect(result.shouldClearOldSession).toBe(true);
    expect(result.sessionToken).not.toBe('tok-2');
    const killed = queries.find((q) =>
      q.text.startsWith('DELETE FROM "session"'),
    );
    expect(killed?.values).toEqual(['s-2']);
    expect(
      queries.some((q) => q.text.startsWith('INSERT INTO "session"')),
    ).toBe(true);
  });
});

/**
 * Org 2FA enforcement on the proxy door: it mints sessions outside the
 * Better Auth sign-in hook, so the grace anchor has to be set here or an
 * enforced policy never starts its clock for proxy-authenticated users.
 */
describe('trustedHeadersAuthenticate — org 2FA enforcement anchors on the proxy door', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    process.env.TRUSTED_HEADERS_INTERNAL_SECRET = 'right-secret';
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-trusted-headers-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgConfigCaches();
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
  });

  it('anchors the grace clock inside the sign-in transaction', async () => {
    const governanceDir = path.join(configRoot, 'proxy-org', 'governance');
    await mkdir(governanceDir, { recursive: true });
    await writeFile(
      path.join(governanceDir, 'two-factor-policy.yml'),
      'enforced: true\ngracePeriodDays: 7\nexemptSsoUsers: false\n',
    );
    const { sql, queries } = fakeSql([
      {
        match: /SELECT "id", "name" FROM "user"/,
        rows: [{ id: 'user-1', name: 'Proxy User' }],
      },
      {
        match: /SELECT "organizationId" FROM "member"/,
        rows: [{ organizationId: 'org-1' }],
      },
      {
        match: /SELECT "slug" FROM "organization"/,
        rows: [{ slug: 'proxy-org' }],
      },
      {
        match: /SELECT "twoFactorEnabled" FROM "user"/,
        rows: [{ twoFactorEnabled: false }],
      },
    ]);

    const result = await trustedHeadersAuthenticate(sql, {
      ...baseArgs,
      secret: 'right-secret',
    });

    expect(result.sessionToken).not.toBe('');
    const anchor = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.two_factor_grace'),
    );
    expect(anchor?.values[0]).toBe('user-1');
    expect(anchor?.values[1]).toBeGreaterThan(Date.now());
  });
});
