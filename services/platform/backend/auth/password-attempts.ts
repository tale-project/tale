import { transactSerializable } from '@tale/shared/db/serializable';
import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';

import {
  clearFailures,
  clearOnSuccess,
  getLockState,
  recordBlocked,
  recordFailure,
} from '../domains/login_attempts/service.ts';
import { checkIpRateLimit, RateLimitExceededError } from '../lib/rate-limit.ts';

/**
 * The throttle every password check passes through: the sign-in endpoint,
 * the re-authentication door (`reauthenticate.ts`) and the confirmations of
 * an account change (`password-confirmations.ts`). A guess at any of them
 * counts against the same per-account lockout and the same per-IP flood
 * guard, so no door is a cheaper way to try passwords than the sign-in form.
 */

/**
 * Where a password was checked other than the sign-in form, as the audit
 * rows name it. Re-authentication mints a session — a sign-in by another
 * door; every other check confirms an account change, which audits itself.
 */
export type PasswordCheck =
  | 'reauthenticate'
  | 'two_factor_enable'
  | 'two_factor_disable'
  | 'backup_codes'
  | 'totp_uri'
  | 'change_password';

// Random delay (ms) added to lockout responses to fuzz the timing channel
// between "wrong password" (bcrypt, ~100ms) and "locked" (a single read).
const LOCKOUT_JITTER_MAX_MS = 200;

export async function jitterDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * LOCKOUT_JITTER_MAX_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Refuse a password attempt over the per-IP flood limit OR against a locked
 * account with 429, surfacing the MAX retry-after of the two. `email` is the
 * canonical address (`normalizeAuthEmail`); without one only the IP limit
 * applies. A refusal never reaches the password check, so it touches only
 * the hourly block counter, never the failure counter.
 */
export async function refuseThrottledPasswordAttempt(
  sql: Sql,
  args: { email: string | null; ip: string },
): Promise<void> {
  const { email, ip } = args;
  let lockoutMs = 0;
  if (email) {
    const { lockedUntil } = await getLockState(sql, email);
    if (lockedUntil !== null && lockedUntil > Date.now()) {
      lockoutMs = lockedUntil - Date.now();
    }
  }

  let ipLimitMs = 0;
  try {
    await checkIpRateLimit(sql, 'security:login-ip', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      ipLimitMs = error.retryAfter;
    } else {
      throw error;
    }
  }

  const retryAfterMs = Math.max(lockoutMs, ipLimitMs);
  if (retryAfterMs > 0) {
    // Better Auth skips after-hooks when a before-hook throws, so the
    // coalesced block-counter write happens HERE.
    if (email) {
      await transactSerializable(sql, (tx) => recordBlocked(tx, { email, ip }));
    }
    await jitterDelay();
    throw new APIError('TOO_MANY_REQUESTS', {
      message: 'Invalid credentials',
      retryAfter: Math.ceil(retryAfterMs / 1000),
    });
  }
}

/**
 * Book the outcome of a password check against `email`: a failure bumps the
 * account's counter (lockout, audit rows, the admin bell at the threshold), a
 * success clears it. A success that signs in — the sign-in form, or
 * re-authentication — also audits `login_success`; a confirmed account
 * change only clears the counter, since the change writes its own row.
 * `check` stamps the rows of every check but the sign-in form's, so an audit
 * reader can tell where the password was typed.
 */
export async function recordPasswordAttempt(
  sql: Sql,
  args: {
    email: string;
    outcome: 'success' | 'failure';
    ip?: string;
    userAgent?: string;
    check?: PasswordCheck;
  },
): Promise<void> {
  const attempt = {
    email: args.email,
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    ...(args.check !== undefined ? { passwordCheck: args.check } : {}),
  };
  const signsIn = args.check === undefined || args.check === 'reauthenticate';
  await transactSerializable(sql, (tx) =>
    args.outcome === 'failure'
      ? recordFailure(tx, attempt).then(() => undefined)
      : signsIn
        ? clearOnSuccess(tx, attempt)
        : clearFailures(tx, args.email),
  );
}
