// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
