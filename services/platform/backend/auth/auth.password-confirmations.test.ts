// @vitest-environment node

/**
 * Turning two-factor on or off, new backup codes, the authenticator's secret
 * and a new password each ask the signed-in person for their password —
 * reachable by anyone holding the session cookie, and none of them counted
 * toward the sign-in lock, so a stolen cookie could try passwords without
 * limit. The auth hooks now hold every such confirmation to the lock before
 * the check and book its outcome after.
 *
 * The hooks are driven directly with the context Better Auth hands them; the
 * throttle's bookkeeping (`password-attempts.ts`) and the session read are
 * spies.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  refuseThrottledPasswordAttempt: vi.fn(),
  recordPasswordAttempt: vi.fn(),
  getSessionFromCtx: vi.fn(),
}));
vi.mock('./password-attempts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./password-attempts.ts')>()),
  refuseThrottledPasswordAttempt: h.refuseThrottledPasswordAttempt,
  recordPasswordAttempt: h.recordPasswordAttempt,
}));
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: h.getSessionFromCtx,
}));
// The hooks read the trusted-proxy list from the governance config first; a
// test has no config tree.
vi.mock('../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/org-config.ts')>()),
  readGovernancePolicy: vi.fn(() => Promise.resolve(null)),
}));
// A successful two-factor change audits itself; that writer is not under test.
vi.mock('../domains/two_factor/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/two_factor/service.ts')
  >()),
  recordTwoFactorLifecycleEvent: vi.fn(() => Promise.resolve()),
}));

import { createAuth } from './auth.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hooks only pass it to the spies
const sql = { name: 'sql' } as unknown as Sql;
const BASE = {
  databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
  secret: 'test-secret-at-least-16-chars',
  baseUrl: 'https://tale.example.com',
  sql,
};
const CLIENT_IP = '203.0.113.7';
const SESSION = {
  session: { id: 'session-1', token: 'token-1' },
  user: { id: 'user-1', email: 'Ada@Example.test' },
};

/** The headers a browser's request carries through the deployment's proxy. */
const browserHeaders = () =>
  new Headers({ 'x-forwarded-for': CLIENT_IP, 'user-agent': 'browser/1.0' });

function hooks() {
  const configured = createAuth(BASE).options.hooks;
  if (configured?.before === undefined || configured.after === undefined) {
    throw new Error('the auth hooks are not wired');
  }
  return configured;
}

type HookContext = {
  path: string;
  body?: unknown;
  context?: { returned?: unknown; session?: unknown };
  /** Over HTTP; omit for a server-side `auth.api` call. */
  overHttp?: boolean;
};

/** Drive a hook with the fields Better Auth hands it. */
function drive(
  hook: (ctx: never) => Promise<unknown>,
  { path, body, context = {}, overHttp = true }: HookContext,
): Promise<unknown> {
  const headers = browserHeaders();
  return hook({
    path,
    body,
    context,
    headers,
    ...(overHttp
      ? {
          request: new Request(`https://tale.example.com/api/auth${path}`, {
            method: 'POST',
            headers,
          }),
        }
      : {}),
  } as never);
}

describe('password confirmations count toward the sign-in lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.refuseThrottledPasswordAttempt.mockResolvedValue(undefined);
    h.recordPasswordAttempt.mockResolvedValue(undefined);
    h.getSessionFromCtx.mockResolvedValue(SESSION);
  });

  it('holds a confirmation to the lock of the account and the address before the check', async () => {
    await drive(hooks().before, {
      path: '/two-factor/disable',
      body: { password: 'guess' },
    });

    expect(h.refuseThrottledPasswordAttempt).toHaveBeenCalledWith(sql, {
      email: 'ada@example.test',
      ip: CLIENT_IP,
    });
  });

  it('lets the lock refuse the confirmation', async () => {
    const locked = new APIError('TOO_MANY_REQUESTS', {
      message: 'Invalid credentials',
      retryAfter: 90,
    });
    h.refuseThrottledPasswordAttempt.mockRejectedValue(locked);

    await expect(
      drive(hooks().before, {
        path: '/change-password',
        body: { currentPassword: 'guess', newPassword: 'next-password' },
      }),
    ).rejects.toBe(locked);
  });

  it('holds the app’s own password door — a server-side call — by the browser’s address', async () => {
    await drive(hooks().before, {
      path: '/change-password',
      body: { currentPassword: 'guess', newPassword: 'next-password' },
      overHttp: false,
    });

    expect(h.refuseThrottledPasswordAttempt).toHaveBeenCalledWith(sql, {
      email: 'ada@example.test',
      ip: CLIENT_IP,
    });
  });

  it('leaves a request with no password, or no session, to the endpoint', async () => {
    await drive(hooks().before, { path: '/two-factor/enable', body: {} });
    h.getSessionFromCtx.mockResolvedValue(null);
    await drive(hooks().before, {
      path: '/two-factor/enable',
      body: { password: 'guess' },
    });

    expect(h.refuseThrottledPasswordAttempt).not.toHaveBeenCalled();
  });

  it('books a wrong password against the account, named by where it was typed', async () => {
    await drive(hooks().after, {
      path: '/change-password',
      body: { currentPassword: 'guess', newPassword: 'next-password' },
      context: {
        returned: new APIError('BAD_REQUEST', {
          message: 'Invalid password',
          code: 'INVALID_PASSWORD',
        }),
        session: SESSION,
      },
    });

    expect(h.recordPasswordAttempt).toHaveBeenCalledWith(sql, {
      email: 'ada@example.test',
      outcome: 'failure',
      check: 'change_password',
      ip: CLIENT_IP,
      userAgent: 'browser/1.0',
    });
  });

  it('books a right password, and nothing for a refusal that never checked it', async () => {
    await drive(hooks().after, {
      path: '/two-factor/enable',
      body: { password: 'right' },
      context: {
        returned: { method: 'totp', totpURI: 'otpauth://x', backupCodes: [] },
        session: SESSION,
      },
    });
    expect(h.recordPasswordAttempt).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        outcome: 'success',
        check: 'two_factor_enable',
      }),
    );

    h.recordPasswordAttempt.mockClear();
    await drive(hooks().after, {
      path: '/change-password',
      body: { currentPassword: 'right', newPassword: 'short' },
      context: {
        returned: new APIError('BAD_REQUEST', {
          message: 'Password too short',
          code: 'PASSWORD_TOO_SHORT',
        }),
        session: SESSION,
      },
    });
    expect(h.recordPasswordAttempt).not.toHaveBeenCalled();
  });

  it('never fails a confirmed change because its booking failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.recordPasswordAttempt.mockRejectedValue(new Error('database gone'));

    await expect(
      drive(hooks().after, {
        path: '/two-factor/disable',
        body: { password: 'right' },
        context: { returned: { status: true }, session: SESSION },
      }),
    ).resolves.not.toThrow();
    expect(error).toHaveBeenCalledWith(
      '[password-confirmation] failed to book the two_factor_disable attempt',
      'database gone',
    );
  });
});
