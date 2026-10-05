// @vitest-environment node

/**
 * The re-authentication door against Better Auth itself: a session older
 * than `SESSION_FRESH_AGE_SECONDS` is refused passkey registration
 * (`SESSION_NOT_FRESH`) until the password is confirmed, and the
 * confirmation hands back a fresh session in place of the old one.
 *
 * Better Auth's memory adapter stands in for Postgres. The lockout and audit
 * bookkeeping (`password-attempts.ts`) and the grace anchor are spies: their
 * own suites and the real-Postgres lane cover what they write.
 */

import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { APIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  PASSWORD_NOT_SET_CODE,
  SESSION_FRESH_AGE_SECONDS,
} from '../../lib/shared/constants/session-freshness.ts';

const h = vi.hoisted(() => ({
  refuseThrottledPasswordAttempt: vi.fn(() => Promise.resolve()),
  recordPasswordAttempt: vi.fn(() => Promise.resolve()),
  anchorTwoFactorGraceOnSignIn: vi.fn(() => Promise.resolve()),
}));
vi.mock('./password-attempts.ts', () => ({
  refuseThrottledPasswordAttempt: h.refuseThrottledPasswordAttempt,
  recordPasswordAttempt: h.recordPasswordAttempt,
}));
vi.mock('../domains/two_factor/service.ts', () => ({
  anchorTwoFactorGraceOnSignIn: h.anchorTwoFactorGraceOnSignIn,
}));

import { reauthenticate } from './reauthenticate.ts';

const BASE = 'https://tale.example.com';
const PASSWORD = 'reauthenticate-test-password';
// The proxy hop the deployment trusts, and the client behind it.
const CLIENT_IP = '203.0.113.7';
const sql = {} as unknown as Sql;

type MemoryDb = Record<string, Record<string, unknown>[]>;

const errorBody = z.object({ code: z.string().optional() }).loose();

/** The `name=value` pairs a response sets, as a request `cookie` header. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

/** The session token a cookie header carries (signed: `token.signature`). */
function sessionTokenOf(cookie: string): string | undefined {
  return /session_token=([^.;]+)/.exec(cookie)?.[1];
}

describe('POST /api/auth/reauthenticate', () => {
  let db: MemoryDb;
  let auth: ReturnType<typeof createTestAuth>;

  function createTestAuth() {
    return betterAuth({
      baseURL: BASE,
      basePath: '/api/auth',
      secret: 'reauthenticate-test-secret-long-enough',
      database: memoryAdapter(db),
      emailAndPassword: { enabled: true, requireEmailVerification: false },
      session: { freshAge: SESSION_FRESH_AGE_SECONDS },
      rateLimit: { enabled: false },
      telemetry: { enabled: false },
      plugins: [
        // Declares the session's `activeOrganizationId`, which carries over.
        organization(),
        passkey({ rpID: 'tale.example.com', rpName: 'Tale', origin: BASE }),
        reauthenticate({
          sql,
          trustedProxies: () => Promise.resolve(['loopback']),
        }),
      ],
    });
  }

  const call = (path: string, init: RequestInit = {}) =>
    auth.handler(new Request(`${BASE}/api/auth${path}`, init));
  const confirm = (cookie: string, password: string) =>
    call('/reauthenticate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE,
        cookie,
        'x-forwarded-for': CLIENT_IP,
        'user-agent': 'reauthenticate-test/1.0',
      },
      body: JSON.stringify({ password }),
    });
  const registrationOptions = (cookie: string) =>
    call('/passkey/generate-register-options', { headers: { cookie } });

  /** A signed-up person and the cookie of their (fresh) session. */
  async function signUp(email = 'ada@example.test') {
    const response = await call('/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ name: 'Ada', email, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    const userId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await response.json()).user.id;
    return { userId, cookie: cookiesOf(response) };
  }

  function sessionRow(token: string | undefined) {
    return db.session?.find((row) => row.token === token);
  }

  /** Date the session back past the fresh window, as a day of use does. */
  function age(cookie: string) {
    const row = sessionRow(sessionTokenOf(cookie));
    if (!row) throw new Error('the session was not stored');
    row.createdAt = new Date(
      Date.now() - (SESSION_FRESH_AGE_SECONDS + 60) * 1000,
    );
    row.activeOrganizationId = 'org-1';
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = {
      user: [],
      session: [],
      account: [],
      verification: [],
      passkey: [],
      organization: [],
      member: [],
      invitation: [],
    };
    auth = createTestAuth();
  });

  it('refuses a passkey to a session past the fresh window, until the password is confirmed', async () => {
    const { userId, cookie } = await signUp();
    expect((await registrationOptions(cookie)).status).toBe(200);

    age(cookie);
    const stale = await registrationOptions(cookie);
    expect(stale.status).toBe(403);
    expect(errorBody.parse(await stale.json()).code).toBe('SESSION_NOT_FRESH');

    const confirmed = await confirm(cookie, PASSWORD);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ status: true });

    // A NEW session replaced the old one: the old token is gone, so a copy
    // of the old cookie does not become fresh with it.
    const freshCookie = cookiesOf(confirmed);
    const freshToken = sessionTokenOf(freshCookie);
    expect(freshToken).toBeDefined();
    expect(freshToken).not.toBe(sessionTokenOf(cookie));
    expect(sessionRow(sessionTokenOf(cookie))).toBeUndefined();
    const fresh = sessionRow(freshToken);
    expect(fresh?.userId).toBe(userId);
    expect(fresh?.activeOrganizationId).toBe('org-1');
    expect(
      Date.now() - new Date(String(fresh?.createdAt)).getTime(),
    ).toBeLessThan(60_000);

    expect((await registrationOptions(freshCookie)).status).toBe(200);
    expect((await registrationOptions(cookie)).status).toBe(401);

    // It counted as a password check: throttled first, booked as a
    // successful re-authentication, and the grace clock anchored.
    expect(h.refuseThrottledPasswordAttempt).toHaveBeenCalledWith(sql, {
      email: 'ada@example.test',
      ip: CLIENT_IP,
    });
    expect(h.recordPasswordAttempt).toHaveBeenCalledWith(sql, {
      email: 'ada@example.test',
      ip: CLIENT_IP,
      userAgent: 'reauthenticate-test/1.0',
      reauthentication: true,
      outcome: 'success',
    });
    expect(h.anchorTwoFactorGraceOnSignIn).toHaveBeenCalledWith(sql, userId);
  });

  it('leaves the session as it was on a wrong password, and counts the failure', async () => {
    const { cookie } = await signUp();
    age(cookie);
    const before = { ...sessionRow(sessionTokenOf(cookie)) };

    const refused = await confirm(cookie, 'not-the-password');

    expect(refused.status).toBe(400);
    expect(errorBody.parse(await refused.json()).code).toBe('INVALID_PASSWORD');
    expect(sessionTokenOf(cookiesOf(refused))).toBeUndefined();
    expect(db.session).toHaveLength(1);
    expect(sessionRow(sessionTokenOf(cookie))?.createdAt).toEqual(
      before.createdAt,
    );
    expect((await registrationOptions(cookie)).status).toBe(403);
    expect(h.recordPasswordAttempt).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ outcome: 'failure', reauthentication: true }),
    );
    expect(h.anchorTwoFactorGraceOnSignIn).not.toHaveBeenCalled();
  });

  it('refuses a throttled account before the password is checked', async () => {
    const { cookie } = await signUp();
    h.refuseThrottledPasswordAttempt.mockRejectedValueOnce(
      new APIError('TOO_MANY_REQUESTS', {
        message: 'Invalid credentials',
        retryAfter: 120,
      }),
    );

    const refused = await confirm(cookie, PASSWORD);

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ retryAfter: 120 });
    expect(h.recordPasswordAttempt).not.toHaveBeenCalled();
    expect(sessionTokenOf(cookiesOf(refused))).toBeUndefined();
  });

  it('tells an account without a password to sign in again', async () => {
    const { userId, cookie } = await signUp();
    // An SSO or proxy account: no credential row to confirm against.
    db.account = (db.account ?? []).filter(
      (row) => !(row.userId === userId && row.providerId === 'credential'),
    );

    const refused = await confirm(cookie, PASSWORD);

    expect(refused.status).toBe(400);
    expect(errorBody.parse(await refused.json()).code).toBe(
      PASSWORD_NOT_SET_CODE,
    );
    expect(h.recordPasswordAttempt).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    const refused = await confirm('', PASSWORD);

    expect(refused.status).toBe(401);
    expect(h.refuseThrottledPasswordAttempt).not.toHaveBeenCalled();
  });
});
