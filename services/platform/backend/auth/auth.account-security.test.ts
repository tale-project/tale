// @vitest-environment node

/**
 * A changed password ends the coding agents the person connected
 * [AGCONN-R17]: the auth hooks end them after Better Auth's own endpoint
 * changed the password — the one the app's route reaches server-side too —
 * and only then.
 *
 * Driven like the password-confirmation hooks: directly, with the context
 * Better Auth hands them.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  endAgentsOf: vi.fn(),
  getSessionFromCtx: vi.fn(),
}));
vi.mock('./account-security.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./account-security.ts')>()),
  endAgentsOf: h.endAgentsOf,
}));
vi.mock('./password-attempts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./password-attempts.ts')>()),
  refuseThrottledPasswordAttempt: vi.fn(() => Promise.resolve()),
  recordPasswordAttempt: vi.fn(() => Promise.resolve()),
}));
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx: h.getSessionFromCtx,
}));
vi.mock('../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/org-config.ts')>()),
  readGovernancePolicy: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../domains/two_factor/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/two_factor/service.ts')
  >()),
  recordTwoFactorLifecycleEvent: vi.fn(() => Promise.resolve()),
}));

import { createAuth } from './auth.ts';

const transaction = { name: 'tx' };
const begin = vi.fn((work: (tx: unknown) => Promise<unknown>) =>
  work(transaction),
);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hooks only open a transaction
const sql = { begin } as unknown as Sql;
const SESSION = {
  session: { id: 'session-1', token: 'token-1' },
  user: { id: 'user-1', email: 'ada@example.test' },
};

function afterHook(): (ctx: never) => Promise<unknown> {
  const configured = createAuth({
    databaseUrl: 'postgresql://tale:pw@localhost:5432/tale_app',
    secret: 'test-secret-at-least-16-chars',
    baseUrl: 'https://tale.example.com',
    sql,
  }).options.hooks;
  if (configured?.after === undefined) throw new Error('no after hook');
  return configured.after;
}

function drive(
  path: string,
  context: { returned?: unknown; session?: unknown },
): Promise<unknown> {
  const headers = new Headers({ 'user-agent': 'browser/1.0' });
  return afterHook()({
    path,
    body: { currentPassword: 'old', newPassword: 'new-password-1' },
    context,
    headers,
    request: new Request(`https://tale.example.com/api/auth${path}`, {
      method: 'POST',
      headers,
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.endAgentsOf.mockResolvedValue(undefined);
  h.getSessionFromCtx.mockResolvedValue(SESSION);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a changed password ends the coding agents of the person [AGCONN-R17]', () => {
  it('ends them, in one transaction, after Better Auth changed the password', async () => {
    await drive('/change-password', {
      returned: { status: true },
      session: SESSION,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(h.endAgentsOf).toHaveBeenCalledExactlyOnceWith(
      transaction,
      'user-1',
    );
  });

  it('ends nothing when the change was refused: a wrong current password, a weak new one', async () => {
    const refused = new APIError('BAD_REQUEST', {
      message: 'Invalid password',
    });
    await drive('/change-password', { returned: refused, session: SESSION });
    expect(h.endAgentsOf).not.toHaveBeenCalled();
  });

  it('ends nothing for any other endpoint, however it went', async () => {
    for (const path of [
      '/two-factor/disable',
      '/sign-in/email',
      '/change-email',
      '/set-password',
      '/update-user',
    ]) {
      await drive(path, { returned: { status: true }, session: SESSION });
    }
    expect(h.endAgentsOf).not.toHaveBeenCalled();
  });

  it('ends nothing, and says nothing, when there is no signed-in person to name', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await drive('/change-password', {
      returned: { status: true },
      session: null,
    });
    await drive('/change-password', {
      returned: { status: true },
      session: {},
    });
    expect(h.endAgentsOf).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('never fails the change that has happened: a failure is logged, loudly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.endAgentsOf.mockRejectedValueOnce(new Error('lock timeout'));
    await expect(
      drive('/change-password', {
        returned: { status: true },
        session: SESSION,
      }),
    ).resolves.not.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('failed to end the coding agents'),
      'lock timeout',
    );
  });
});
