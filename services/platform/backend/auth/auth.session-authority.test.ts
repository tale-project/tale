// @vitest-environment node

/** The production factory's complete hook/plugin order, with the maintained
 * memory adapter. Bookkeeping is isolated; password checks and HTTP dispatch
 * are real. PostgreSQL and genuine WebAuthn have their integration proof. */
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import pg from 'pg';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./password-attempts.ts', () => ({
  refuseThrottledPasswordAttempt: vi.fn(async () => {}),
  recordPasswordAttempt: vi.fn(async () => {}),
  jitterDelay: vi.fn(async () => {}),
}));
vi.mock('../domains/two_factor/service.ts', async (original) => ({
  ...(await original<typeof import('../domains/two_factor/service.ts')>()),
  anchorTwoFactorGraceOnSignIn: vi.fn(async () => ({ decision: 'allowed' })),
  recordTwoFactorLifecycleEvent: vi.fn(async () => {}),
}));
vi.mock('../lib/org-config.ts', async (original) => ({
  ...(await original<typeof import('../lib/org-config.ts')>()),
  readGovernancePolicy: vi.fn(async () => null),
}));

import { SESSION_ORGANIZATION_MESSAGE } from '../../lib/shared/constants/session-authority.ts';
import { createAuth } from './auth.ts';
import { setSessionMintAuthority } from './passkey-authority.ts';

const BASE = 'https://tale.example.test';
const PASSWORD = 'Session-authority-fixture!8';
type Row = Record<string, unknown>;
type MemoryDb = Record<string, Row[]>;

function database(db: MemoryDb): Sql {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM "session" s')) {
      const row = db.session?.find((entry) => entry.id === values[0]);
      return row === undefined
        ? []
        : [
            {
              ...row,
              live: true,
              refused: false,
              activeTeamOrganizationId:
                db.team?.find((team) => team.id === row.activeTeamId)
                  ?.organizationId ?? null,
            },
          ];
    }
    if (text.includes('FROM "apikey"')) {
      const row = db.apikey?.find((entry) => entry.id === values[0]);
      return row === undefined ? [] : [{ userId: row.referenceId }];
    }
    if (text.includes('FROM "member"'))
      return [{ organizationId: 'org-a', role: 'owner' }];
    if (text.includes('FROM "user"')) return [{ id: 'present' }];
    if (text.includes('UPDATE "apikey"')) return [];
    return [];
  };
  return Object.assign(tag, {
    begin: async (run: (tx: unknown) => unknown) => run(tag),
  }) as unknown as Sql;
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

describe('the production scoped-session plugin after every identity injector', () => {
  let db: MemoryDb;
  let factory: ReturnType<typeof createAuth>;
  // Keep the fixture's seam structural. Better Auth's inferred plugin tuple
  // is intentionally narrower than its broad factory generic after the
  // coding-agent provider was added; this test only drives the handler.
  let auth: { handler(request: Request): Promise<Response> };
  let cookie: string;

  const call = (
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) =>
    auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: BASE,
          'content-type': 'application/json',
          cookie,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  /** A personal key of the signed-in person, in plaintext. */
  const createKey = async (name: string): Promise<string> => {
    const created = await call('/api-key/create', { name });
    expect(created.status).toBe(200);
    const body: unknown = await created.json();
    if (
      body === null ||
      typeof body !== 'object' ||
      !('key' in body) ||
      typeof body.key !== 'string'
    ) {
      throw new Error('The fixture key response was unreadable');
    }
    return body.key;
  };

  /** The session a sign-in answered with, found by the token it returned. */
  const signedInSession = async (response: Response): Promise<Row> => {
    const body: unknown = await response.json();
    if (
      body === null ||
      typeof body !== 'object' ||
      !('token' in body) ||
      typeof body.token !== 'string'
    ) {
      throw new Error('The sign-in response named no session');
    }
    const token = body.token;
    const session = db.session?.find((entry) => entry.token === token);
    if (session === undefined)
      throw new Error('The signed-in session was missing');
    return session;
  };

  /** What a session holds that a presented one could lend a new one. */
  const authorityOf = (session: Row) => ({
    userId: session.userId,
    trustedOrganizationId: session.trustedOrganizationId ?? null,
    trustedRole: session.trustedRole ?? null,
    activeOrganizationId: session.activeOrganizationId ?? null,
    activeTeamId: session.activeTeamId ?? null,
  });

  beforeEach(async () => {
    vi.stubEnv('TALE_ORG_SESSION_CUTOVER_AT', '');
    vi.stubEnv('TALE_ALLOW_OPEN_SIGN_UP', 'true');
    db = Object.fromEntries(
      [
        'user',
        'session',
        'account',
        'verification',
        'passkey',
        'apikey',
        'organization',
        'member',
        'invitation',
        'team',
        'teamMember',
        'oauthClient',
        'oauthAccessToken',
        'oauthRefreshToken',
        'oauthConsent',
        'jwks',
        'twoFactor',
      ].map((name) => [name, []]),
    );
    factory = createAuth({
      databaseUrl: 'postgres://unused.invalid/auth-fixture',
      baseUrl: BASE,
      secret: 'session-authority-unit-fixture-secret-long-enough',
      sql: database(db),
    });
    auth = betterAuth({
      ...factory.options,
      database: memoryAdapter(db),
      telemetry: { enabled: false },
    });
    cookie = '';
    const signup = await call('/sign-up/email', {
      name: 'Ada',
      email: 'ada@example.invalid',
      password: PASSWORD,
    });
    expect(signup.status).toBe(200);
    cookie = cookies(signup);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (factory.options.database instanceof pg.Pool)
      await factory.options.database.end();
  });

  it('keeps global account and personal-key positive controls', async () => {
    expect((await call('/update-user', { name: 'Ada Lovelace' })).status).toBe(
      200,
    );
    expect(
      (await call('/api-key/create', { name: 'fixture key' })).status,
    ).toBe(200);
    // This standalone JWT door is already disabled for every caller.
    expect((await call('/token')).status).toBe(404);
  });

  it('rejects scoped personal-key/JWT issuance after an independent account proof', async () => {
    Object.assign(db.session?.[0] ?? {}, {
      trustedOrganizationId: 'org-a',
      activeOrganizationId: 'org-b',
      independentIdentityVerifiedAt: new Date(),
    });
    expect((await call('/update-user', { name: 'Scoped Ada' })).status).toBe(
      200,
    );
    expect(
      (await call('/api-key/create', { name: 'unbound key' })).status,
    ).toBe(403);
    expect((await call('/token')).status).toBe(404);
    expect(db.apikey).toHaveLength(0);
    expect(db.session?.[0]?.trustedOrganizationId).toBe('org-a');
  });

  it('refuses a scoped account change without accepting client proof or scope fields', async () => {
    Object.assign(db.session?.[0] ?? {}, {
      trustedOrganizationId: 'org-a',
      independentIdentityVerifiedAt: null,
    });
    const response = await call('/update-user', {
      name: 'Spoofed Ada',
      trustedOrganizationId: null,
      independentIdentityVerifiedAt: new Date().toISOString(),
    });
    expect(response.status).toBe(403);
    expect(db.user?.[0]?.name).toBe('Ada');
    expect(db.session?.[0]?.trustedOrganizationId).toBe('org-a');
  });

  it('confirms a real password into a rotated session without expanding its realm', async () => {
    const previous = db.session?.[0];
    if (previous === undefined)
      throw new Error('The fixture session was missing');
    const previousId = previous.id;
    Object.assign(previous, {
      trustedOrganizationId: 'org-a',
      trustedRole: 'member',
      activeOrganizationId: 'org-b',
      independentIdentityVerifiedAt: null,
    });
    const confirmed = await call('/reauthenticate', { password: PASSWORD });
    expect(confirmed.status).toBe(200);
    expect(db.session).toHaveLength(1);
    expect(db.session?.[0]?.id).not.toBe(previousId);
    expect(db.session?.[0]).toMatchObject({
      trustedOrganizationId: 'org-a',
      trustedRole: 'member',
      activeOrganizationId: 'org-a',
    });
    expect(db.session?.[0]?.independentIdentityVerifiedAt).toBeInstanceOf(Date);
    cookie = cookies(confirmed);
    expect(
      (await call('/api-key/create', { name: 'unbound after proof' })).status,
    ).toBe(403);
  });

  it('does not let the real API-key plugin injection mint another key or factor', async () => {
    const key = await createKey('existing key');
    cookie = '';
    const headers = { 'x-api-key': key };
    expect(
      (await call('/api-key/create', { name: 'derived key' }, headers)).status,
    ).toBe(403);
    expect(
      (
        await call(
          '/change-password',
          { currentPassword: PASSWORD, newPassword: PASSWORD },
          headers,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('/passkey/generate-register-options', undefined, headers))
        .status,
    ).toBe(403);
    expect(db.apikey).toHaveLength(1);
  });

  it('does not read another realm through the plugin active-team default, and retains an own-team control', async () => {
    const userId = db.user?.[0]?.id;
    Object.assign(db.session?.[0] ?? {}, {
      trustedOrganizationId: 'org-a',
      activeOrganizationId: 'org-b',
      activeTeamId: 'team-b',
    });
    db.organization = [
      { id: 'org-a', name: 'A', slug: 'a', createdAt: new Date() },
      { id: 'org-b', name: 'B', slug: 'b', createdAt: new Date() },
    ];
    db.member = [
      {
        id: 'member-a',
        organizationId: 'org-a',
        userId,
        role: 'owner',
        createdAt: new Date(),
      },
      {
        id: 'member-b',
        organizationId: 'org-b',
        userId,
        role: 'owner',
        createdAt: new Date(),
      },
    ];
    db.team = [
      {
        id: 'team-a',
        organizationId: 'org-a',
        name: 'A team',
        createdAt: new Date(),
      },
      {
        id: 'team-b',
        organizationId: 'org-b',
        name: 'B team',
        createdAt: new Date(),
      },
    ];
    db.teamMember = [
      { id: 'team-member-a', teamId: 'team-a', userId, createdAt: new Date() },
      { id: 'team-member-b', teamId: 'team-b', userId, createdAt: new Date() },
    ];
    expect((await call('/organization/list-team-members')).status).toBe(400);
    expect(db.session?.[0]?.activeTeamId).toBe('team-b');
    Object.assign(db.session?.[0] ?? {}, { activeTeamId: 'team-a' });
    expect((await call('/organization/list-team-members')).status).toBe(200);
    expect(
      (await call('/organization/set-active-team', { teamId: null })).status,
    ).toBe(200);
  });

  it.each([
    ['a global session with a role', 'global'],
    ['an organization-limited session', 'organization'],
    ['an API key', 'key'],
  ] as const)(
    'signs another person in over %s as from an empty cookie jar (#4919)',
    async (_held, door) => {
      const ada = db.session?.[0];
      if (ada === undefined) throw new Error('The fixture session was missing');
      const grace = { email: 'grace@example.invalid', password: PASSWORD };
      const emptyJar = { cookie: '' };
      expect(
        (await call('/sign-up/email', { name: 'Grace', ...grace }, emptyJar))
          .status,
      ).toBe(200);
      const alone = await call('/sign-in/email', grace, emptyJar);
      expect(alone.status).toBe(200);
      const expected = authorityOf(await signedInSession(alone));
      expect(expected).toMatchObject({
        trustedOrganizationId: null,
        trustedRole: null,
      });

      let headers: Record<string, string> = {};
      if (door === 'key') {
        headers = { 'x-api-key': await createKey('Ada key') };
        cookie = '';
      } else {
        Object.assign(ada, {
          trustedRole: 'member',
          ...(door === 'organization'
            ? {
                trustedOrganizationId: 'org-a',
                activeOrganizationId: 'org-a',
                independentIdentityVerifiedAt: new Date(),
              }
            : {}),
        });
      }
      const held = { ...ada };

      const signedIn = await call('/sign-in/email', grace, headers);
      expect(signedIn.status).toBe(200);
      const session = await signedInSession(signedIn);
      expect(authorityOf(session)).toEqual(expected);
      expect(session.independentIdentityVerifiedAt).toBeInstanceOf(Date);
      // The session and key Ada presented stay Ada's to end; the browser now
      // carries Grace's session.
      expect(db.session?.find((entry) => entry.id === held.id)).toEqual(held);
      expect(db.apikey).toHaveLength(door === 'key' ? 1 : 0);
      cookie = cookies(signedIn);
      expect(await (await call('/get-session')).json()).toMatchObject({
        user: { email: grace.email },
      });
    },
  );

  it("still carries the presented session's authority into the same person's sign-in", async () => {
    Object.assign(db.session?.[0] ?? {}, { trustedRole: 'member' });
    const signedIn = await call('/sign-in/email', {
      email: 'ada@example.invalid',
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    expect(authorityOf(await signedInSession(signedIn))).toMatchObject({
      userId: db.user?.[0]?.id,
      trustedOrganizationId: null,
      trustedRole: 'member',
    });
  });

  it.each(['ada@example.invalid', 'ADA@EXAMPLE.INVALID'])(
    'still refuses the same person (%s) a sign-in over their organization-limited session',
    async (email) => {
      Object.assign(db.session?.[0] ?? {}, {
        trustedOrganizationId: 'org-a',
        trustedRole: 'member',
        activeOrganizationId: 'org-a',
      });
      const refused = await call('/sign-in/email', {
        email,
        password: PASSWORD,
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        code: 'ORG_FORBIDDEN',
        message: SESSION_ORGANIZATION_MESSAGE,
      });
      expect(db.session).toHaveLength(1);
    },
  );

  it.each([
    '/reauthenticate',
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
    '/sign-in/email',
  ])(
    'still refuses %s a session for another person than the presented one',
    async (path) => {
      const before = factory.options.databaseHooks?.session?.create?.before;
      if (typeof before !== 'function')
        throw new Error('The session-create hook was missing');
      const ctx = {
        path,
        request: new Request(`${BASE}/api/auth${path}`, { method: 'POST' }),
        context: {},
      };
      // What the presented session lends the request it arrived with.
      setSessionMintAuthority(ctx, {
        userId: 'user-ada',
        organizationId: 'org-a',
        trustedRole: 'member',
        independentIdentityVerifiedAt: null,
      });
      const sessionOf = (userId: string) => ({
        id: `session-${userId}`,
        token: `token-${userId}`,
        userId,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        Promise.resolve().then(() =>
          before(sessionOf('user-grace'), ctx as never),
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        body: { code: 'ORG_FORBIDDEN' },
      });
      await expect(
        before(sessionOf('user-ada'), ctx as never),
      ).resolves.toMatchObject({
        data: {
          userId: 'user-ada',
          trustedOrganizationId: 'org-a',
          trustedRole: 'member',
          activeOrganizationId: 'org-a',
        },
      });
    },
  );
});
