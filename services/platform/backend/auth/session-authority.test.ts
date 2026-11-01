// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeScopedAuthEndpoint,
  orgSessionCutoverAt,
  requireAccountIdentity,
  requireGlobalSession,
  resolveSessionAuthority,
  sessionAllowsOrganization,
  sessionHasFreshAccountProof,
  sessionOrganizationId,
} from './session-authority.ts';
import type { AuthEnv, SessionBundle } from './session.ts';

const bundle = (session: object = {}): SessionBundle => ({
  user: { id: 'user-a', email: 'a@example.invalid', name: 'A' },
  session: { id: 'session-a', ...session },
});

function database(answer: (text: string, values: unknown[]) => unknown[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  return { sql: tag as unknown as Sql, queries };
}

describe('server-owned organization session scope', () => {
  it.each([undefined, null])(
    'retains an ordinary global marker %s',
    (marker) => {
      expect(
        sessionOrganizationId({ trustedOrganizationId: marker }),
      ).toBeNull();
      expect(
        sessionAllowsOrganization({ trustedOrganizationId: marker }, 'org-b'),
      ).toBe(true);
    },
  );
  it.each(['', ' org-a', 'org-a ', 42, {}, []])(
    'refuses malformed marker %j',
    (marker) => {
      expect(
        sessionOrganizationId({ trustedOrganizationId: marker }),
      ).toBeUndefined();
      expect(
        sessionAllowsOrganization({ trustedOrganizationId: marker }, 'org-a'),
      ).toBe(false);
    },
  );
  it('does not broaden scope when the account has independent proof', () => {
    const session = {
      trustedOrganizationId: 'org-a',
      independentIdentityVerifiedAt: new Date(),
    };
    expect(sessionHasFreshAccountProof(session)).toBe(true);
    expect(sessionAllowsOrganization(session, 'org-a')).toBe(true);
    expect(sessionAllowsOrganization(session, 'org-b')).toBe(false);
  });
  it('does not accept future, malformed, or lapsed account proof', () => {
    for (const date of [
      'unreadable',
      new Date(Date.now() + 60_000),
      new Date(0),
      1234,
    ]) {
      expect(
        sessionHasFreshAccountProof({ independentIdentityVerifiedAt: date }),
      ).toBe(false);
    }
  });
  it('accepts only the exact operator UTC fence, including a real calendar date', () => {
    expect(orgSessionCutoverAt({})).toBeNull();
    expect(orgSessionCutoverAt({ TALE_ORG_SESSION_CUTOVER_AT: '' })).toBeNull();
    expect(
      orgSessionCutoverAt({
        TALE_ORG_SESSION_CUTOVER_AT: '2026-10-12T20:00:00.000Z',
      }),
    ).toBe(Date.UTC(2026, 9, 12, 20));
    for (const value of [
      ' ',
      '2026-10-12',
      '2026-10-12T20:00:00Z',
      '2026-10-12T20:00:00.000+00:00',
      '2026-02-30T20:00:00.000Z',
    ]) {
      expect(() =>
        orgSessionCutoverAt({ TALE_ORG_SESSION_CUTOVER_AT: value }),
      ).toThrow('exact UTC');
    }
  });
});

describe('the production persisted authority adapter', () => {
  it.each([
    ['org-a', 'org-b', null],
    ['org-a', 'org-a', 'team-current'],
    [null, 'org-b', 'team-current'],
  ])(
    'binds the actual persisted active-team default to realm %s (team realm %s)',
    async (realm, teamRealm, expected) => {
      const { sql } = database(() => [
        {
          userId: 'user-a',
          trustedOrganizationId: realm,
          activeOrganizationId: 'org-b',
          activeTeamId: 'team-current',
          activeTeamOrganizationId: teamRealm,
          trustedRole: null,
          independentIdentityVerifiedAt: null,
          updatedAt: new Date(),
          live: true,
          refused: false,
        },
      ]);
      const current = await resolveSessionAuthority(
        sql,
        bundle({ activeTeamId: 'stale-foreign-team' }),
        null,
      );
      expect(Reflect.get(current?.session ?? {}, 'activeTeamId')).toBe(
        expected,
      );
    },
  );
  it('overrides a stale global bundle with the current marker, role and proof', async () => {
    const { sql, queries } = database(() => [
      {
        userId: 'user-a',
        trustedOrganizationId: 'org-a',
        trustedRole: 'member',
        activeOrganizationId: 'org-b',
        independentIdentityVerifiedAt: null,
        updatedAt: new Date(),
        live: true,
      },
    ]);
    const current = await resolveSessionAuthority(
      sql,
      bundle({
        trustedOrganizationId: null,
        trustedRole: 'owner',
        independentIdentityVerifiedAt: new Date(),
        activeOrganizationId: 'org-b',
      }),
      null,
    );
    expect(current?.session).toMatchObject({
      trustedOrganizationId: 'org-a',
      trustedRole: 'member',
      independentIdentityVerifiedAt: null,
      activeOrganizationId: 'org-a',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.values).toEqual(['session-a']);
  });
  it.each([
    { userId: 'someone-else', live: true },
    { userId: 'user-a', live: false },
  ])('refuses a mismatched or expired persisted row', async (row) => {
    const { sql } = database(() => [{ ...row, trustedOrganizationId: null }]);
    expect(await resolveSessionAuthority(sql, bundle(), null)).toBeNull();
  });
  it('rejects legacy unmarked SSO cookies only after cutover, without writing any row', async () => {
    const { sql, queries } = database((text) =>
      text.includes('FROM "session"')
        ? [
            {
              userId: 'user-a',
              trustedOrganizationId: null,
              trustedRole: null,
              independentIdentityVerifiedAt: null,
              activeOrganizationId: 'org-a',
              updatedAt: new Date(),
              live: true,
              refused: true,
            },
          ]
        : [{ id: 'sso-link' }],
    );
    expect(await resolveSessionAuthority(sql, bundle(), null)).not.toBeNull();
    expect(await resolveSessionAuthority(sql, bundle(), 0)).toBeNull();
    expect(
      queries.every((query) => query.text.trimStart().startsWith('SELECT')),
    ).toBe(true);
  });
  it('retains a first-party proven global session even with SSO links after cutover', async () => {
    const { sql, queries } = database(() => [
      {
        userId: 'user-a',
        trustedOrganizationId: null,
        trustedRole: null,
        independentIdentityVerifiedAt: new Date(0),
        activeOrganizationId: 'org-a',
        updatedAt: new Date(),
        live: true,
      },
    ]);
    expect(await resolveSessionAuthority(sql, bundle(), 0)).not.toBeNull();
    expect(queries).toHaveLength(1);
  });
  it.each([null, 'org-a'])(
    'never revives a captured cookie after unlink, later proof or marker %s',
    async (realm) => {
      const { sql, queries } = database(() => [
        {
          userId: 'user-a',
          trustedOrganizationId: realm,
          trustedRole: 'owner',
          independentIdentityVerifiedAt: new Date(),
          activeOrganizationId: 'org-a',
          live: true,
          refused: true,
        },
      ]);
      expect(await resolveSessionAuthority(sql, bundle(), 0)).toBeNull();
      expect(queries).toHaveLength(1);
      expect(queries[0]?.text).toContain(
        'r.session_id = s."id" AND r.user_id = s."userId"',
      );
      expect(queries[0]?.text).not.toContain('FROM "account"');
    },
  );
  it('distinguishes the real synthetic key and retains its owner binding', async () => {
    const { sql } = database((text) => {
      if (text.includes('FROM "session"')) return [];
      if (text.includes('FROM "apikey"')) return [{ userId: 'user-a' }];
      return [
        {
          apiKeyId: 'session-a',
          organizationId: 'org-a',
          kind: 'member',
          keyUserId: 'user-a',
          principalUserId: 'person-a',
          teamId: null,
          projectId: null,
          role: null,
          name: 'bound key',
          createdBy: 'owner-a',
          createdAt: 1,
          revokedAt: null,
          revokedBy: null,
        },
      ];
    });
    const current = await resolveSessionAuthority(sql, bundle(), 0);
    expect(current?.session).toMatchObject({
      trustedOrganizationId: 'org-a',
      authenticationDoor: 'api-key',
      independentIdentityVerifiedAt: null,
    });
    expect(current?.user.id).toBe('user-a');
  });
});

describe('every authorization records the use the idle sweep reads', () => {
  const NOW = Date.parse('2026-11-01T12:00:00Z');
  const MINUTE = 60_000;
  const row = (fields: object = {}) => ({
    userId: 'user-a',
    trustedOrganizationId: 'org-a',
    trustedRole: null,
    activeOrganizationId: 'org-a',
    activeTeamId: null,
    activeTeamOrganizationId: null,
    independentIdentityVerifiedAt: null,
    updatedAt: new Date(NOW - 10 * MINUTE),
    live: true,
    refused: false,
    ...fields,
  });
  const writes = (queries: { text: string; values: unknown[] }[]) =>
    queries.filter((query) => !query.text.trimStart().startsWith('SELECT'));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // The row an organization's single sign-on mints lives 30 days against
  // Better Auth's 7, so Better Auth first slides it some 23 days on; until
  // then the sweep read its sign-in as its last use (#5249).
  it('records the use of a single sign-on session, and never its expiry [SSO-R23]', async () => {
    const { sql, queries } = database((text) =>
      text.includes('FROM "session" s') ? [row()] : [],
    );

    const current = await resolveSessionAuthority(sql, bundle(), null);

    expect(current?.session).toMatchObject({ trustedOrganizationId: 'org-a' });
    expect(writes(queries)).toHaveLength(1);
    const [write] = writes(queries);
    expect(write?.text).toContain('UPDATE "session" SET "updatedAt" = ?');
    expect(write?.text).not.toContain('expiresAt');
    // Conditional: of two requests in the same minute, one writes.
    expect(write?.text).toContain('"updatedAt" <= ?');
    expect(write?.values).toEqual([
      new Date(NOW),
      'session-a',
      new Date(NOW - MINUTE),
    ]);
  });

  it('records a "don\'t remember me" session\'s use as well, which Better Auth never slides', async () => {
    const { sql, queries } = database((text) =>
      text.includes('FROM "session" s')
        ? [row({ trustedOrganizationId: null, activeOrganizationId: null })]
        : [],
    );

    expect(await resolveSessionAuthority(sql, bundle(), null)).not.toBeNull();
    expect(writes(queries)).toHaveLength(1);
  });

  it('writes nothing for a use recorded within the minute', async () => {
    const { sql, queries } = database(() => [
      row({ updatedAt: new Date(NOW - MINUTE + 1_000) }),
    ]);

    expect(await resolveSessionAuthority(sql, bundle(), null)).not.toBeNull();
    expect(queries).toHaveLength(1);
  });

  it.each([
    ["another person's row", { userId: 'someone-else' }, null],
    ['an expired row', { live: false }, null],
    ['a legacy row refused after the cutover', { refused: true }, 0],
    [
      'a malformed organization binding',
      { trustedOrganizationId: ' org-a' },
      null,
    ],
  ])('records no use on a refusal: %s', async (_name, fields, cutoverAt) => {
    const { sql, queries } = database(() => [row(fields)]);

    expect(await resolveSessionAuthority(sql, bundle(), cutoverAt)).toBeNull();
    expect(writes(queries)).toEqual([]);
  });

  it('records no use for an API key, which has no browser row', async () => {
    const { sql, queries } = database((text) =>
      text.includes('FROM "apikey"') ? [{ userId: 'user-a' }] : [],
    );

    expect(await resolveSessionAuthority(sql, bundle(), null)).toMatchObject({
      session: { authenticationDoor: 'api-key' },
    });
    expect(writes(queries)).toEqual([]);
  });

  it('keeps the request authorized when the write fails, and says so', async () => {
    const failure = new Error('the write was refused');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql } = database((text) => {
      if (text.trimStart().startsWith('UPDATE')) throw failure;
      return [row()];
    });

    expect(await resolveSessionAuthority(sql, bundle(), null)).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[session-use] could not record a session use:',
      failure,
    );
  });
});

describe('account proof and unbound delegation remain separate', () => {
  async function request(
    session: object,
    guard: ReturnType<typeof requireGlobalSession>,
  ) {
    const app = new Hono<AuthEnv>();
    app.use(async (c, next) => {
      c.set('sessionBundle', bundle(session));
      await next();
    });
    app.use(guard);
    app.get('/', (c) => c.json({ allowed: true }));
    return (await app.request('/')).status;
  }
  it('admits account changes only with independent proof, keeping global controls', async () => {
    expect(await request({}, requireAccountIdentity())).toBe(200);
    expect(
      await request(
        { trustedOrganizationId: 'org-a' },
        requireAccountIdentity(),
      ),
    ).toBe(403);
    expect(
      await request(
        {
          trustedOrganizationId: 'org-a',
          independentIdentityVerifiedAt: new Date(),
        },
        requireAccountIdentity(),
      ),
    ).toBe(200);
    expect(
      await request(
        { authenticationDoor: 'api-key' },
        requireAccountIdentity(),
      ),
    ).toBe(403);
  });
  it('never turns account proof into an unscoped session', async () => {
    expect(await request({}, requireGlobalSession())).toBe(200);
    expect(
      await request(
        {
          trustedOrganizationId: 'org-a',
          independentIdentityVerifiedAt: new Date(),
        },
        requireGlobalSession(),
      ),
    ).toBe(403);
  });
  it.each([
    '/api-key/create',
    '/token',
    '/oauth2/authorize',
    '/oauth2/consent',
    '/sign-in/email',
    '/unclassified-future-plugin',
  ])('refuses scoped unbound door %s despite account proof', async (path) => {
    const { sql, queries } = database(() => []);
    await expect(
      authorizeScopedAuthEndpoint(
        sql,
        bundle({
          trustedOrganizationId: 'org-a',
          independentIdentityVerifiedAt: new Date(),
        }),
        {
          path,
          body: {},
          query: {},
          overHttp: true,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(queries).toHaveLength(0);
  });
  it.each([
    '/api-key/create',
    '/token',
    '/oauth2/authorize',
    '/passkey/verify-registration',
    '/set-password',
  ])(
    'does not take a synthetic global key as browser identity at %s',
    async (path) => {
      const { sql } = database(() => []);
      await expect(
        authorizeScopedAuthEndpoint(
          sql,
          bundle({ authenticationDoor: 'api-key' }),
          {
            path,
            body: {},
            query: {},
            overHttp: true,
          },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it('keeps an organization request and first-party confirmation inside the realm', async () => {
    const { sql } = database(() => []);
    const scoped = bundle({ trustedOrganizationId: 'org-a' });
    await expect(
      authorizeScopedAuthEndpoint(sql, scoped, {
        path: '/organization/list-members',
        body: { organizationId: 'org-a' },
        query: {},
        overHttp: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      authorizeScopedAuthEndpoint(sql, scoped, {
        path: '/reauthenticate',
        body: {},
        query: {},
        overHttp: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      authorizeScopedAuthEndpoint(sql, scoped, {
        path: '/organization/list-members',
        body: { organizationId: 'org-b' },
        query: {},
        overHttp: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
