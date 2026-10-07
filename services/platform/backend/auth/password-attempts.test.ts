// @vitest-environment node

/**
 * The throttle every password door shares — sign-in, the re-authentication
 * that freshens a session, and the confirmations of an account change. A
 * guess at any of them is refused while the account is locked or the address
 * floods, and counts against the same account.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getLockState: vi.fn(),
  recordBlocked: vi.fn(),
  recordFailure: vi.fn(),
  clearOnSuccess: vi.fn(),
  clearFailures: vi.fn(),
  checkIpRateLimit: vi.fn(),
}));
vi.mock('../domains/login_attempts/service.ts', () => ({
  getLockState: h.getLockState,
  recordBlocked: h.recordBlocked,
  recordFailure: h.recordFailure,
  clearOnSuccess: h.clearOnSuccess,
  clearFailures: h.clearFailures,
}));
vi.mock('../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rate-limit.ts')>()),
  checkIpRateLimit: h.checkIpRateLimit,
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (sql: unknown, run: (tx: unknown) => unknown) =>
    run(sql),
}));

import { RateLimitExceededError } from '../lib/rate-limit.ts';
import {
  recordPasswordAttempt,
  refuseThrottledPasswordAttempt,
} from './password-attempts.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the calls under test only pass it through
const sql = { name: 'sql' } as unknown as Sql;
const EMAIL = 'ada@example.test';
const IP = '203.0.113.7';

/** The 429 a refusal throws, or null when the attempt may proceed. */
async function refusal(email: string | null): Promise<APIError | null> {
  try {
    await refuseThrottledPasswordAttempt(sql, { email, ip: IP });
    return null;
  } catch (error) {
    if (error instanceof APIError) return error;
    throw error;
  }
}

describe('refuseThrottledPasswordAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getLockState.mockResolvedValue({ lockedUntil: null });
    h.checkIpRateLimit.mockResolvedValue(undefined);
    h.recordBlocked.mockResolvedValue(undefined);
  });

  it('lets an attempt through when neither the account nor the address is held', async () => {
    expect(await refusal(EMAIL)).toBeNull();
    expect(h.getLockState).toHaveBeenCalledWith(sql, EMAIL);
    expect(h.checkIpRateLimit).toHaveBeenCalledWith(
      sql,
      'security:login-ip',
      IP,
    );
    expect(h.recordBlocked).not.toHaveBeenCalled();
  });

  it('refuses a locked account with the wait in seconds, and counts the block', async () => {
    h.getLockState.mockResolvedValue({ lockedUntil: Date.now() + 90_500 });

    const refused = await refusal(EMAIL);

    expect(refused?.statusCode).toBe(429);
    expect(refused?.body).toMatchObject({ retryAfter: 91 });
    expect(h.recordBlocked).toHaveBeenCalledWith(sql, { email: EMAIL, ip: IP });
  });

  it('refuses a flooding address with the longer of the two waits', async () => {
    h.getLockState.mockResolvedValue({ lockedUntil: Date.now() + 10_000 });
    h.checkIpRateLimit.mockRejectedValue(
      new RateLimitExceededError('over', 60_000),
    );

    const refused = await refusal(EMAIL);

    expect(refused?.statusCode).toBe(429);
    expect(refused?.body).toMatchObject({ retryAfter: 60 });
  });

  it('holds an attempt without an address to the IP limit alone', async () => {
    h.checkIpRateLimit.mockRejectedValue(
      new RateLimitExceededError('over', 5_000),
    );

    const refused = await refusal(null);

    expect(refused?.statusCode).toBe(429);
    expect(h.getLockState).not.toHaveBeenCalled();
    expect(h.recordBlocked).not.toHaveBeenCalled();
  });

  it('lets a failing limiter fail the attempt rather than wave it through', async () => {
    const outage = new Error('connection refused');
    h.checkIpRateLimit.mockRejectedValue(outage);

    await expect(
      refuseThrottledPasswordAttempt(sql, { email: EMAIL, ip: IP }),
    ).rejects.toBe(outage);
  });
});

describe('recordPasswordAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.recordFailure.mockResolvedValue({ locked: false, lockedUntil: null });
    h.clearOnSuccess.mockResolvedValue(undefined);
    h.clearFailures.mockResolvedValue(undefined);
  });

  it('books a failure against the account, stamped with where it was typed', async () => {
    await recordPasswordAttempt(sql, {
      email: EMAIL,
      outcome: 'failure',
      ip: IP,
      userAgent: 'test/1.0',
      check: 'two_factor_disable',
    });

    expect(h.recordFailure).toHaveBeenCalledWith(sql, {
      email: EMAIL,
      ip: IP,
      userAgent: 'test/1.0',
      passwordCheck: 'two_factor_disable',
    });
    expect(h.clearOnSuccess).not.toHaveBeenCalled();
  });

  it('audits a sign-in success, leaving the sign-in form unstamped', async () => {
    await recordPasswordAttempt(sql, { email: EMAIL, outcome: 'success' });

    expect(h.clearOnSuccess).toHaveBeenCalledWith(sql, { email: EMAIL });
    expect(h.recordFailure).not.toHaveBeenCalled();
  });

  it('audits a re-authentication as the sign-in it is', async () => {
    await recordPasswordAttempt(sql, {
      email: EMAIL,
      outcome: 'success',
      check: 'reauthenticate',
    });

    expect(h.clearOnSuccess).toHaveBeenCalledWith(sql, {
      email: EMAIL,
      passwordCheck: 'reauthenticate',
    });
    expect(h.clearFailures).not.toHaveBeenCalled();
  });

  it('only clears the counter when a confirmed account change succeeds — the change audits itself', async () => {
    await recordPasswordAttempt(sql, {
      email: EMAIL,
      outcome: 'success',
      check: 'change_password',
    });

    expect(h.clearFailures).toHaveBeenCalledWith(sql, EMAIL);
    expect(h.clearOnSuccess).not.toHaveBeenCalled();
  });
});
