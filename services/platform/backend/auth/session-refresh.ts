import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
  type SessionRefreshShape,
  sessionRefreshShape,
} from '@tale/shared/utils/session-idle';
import type { Sql } from 'postgres';

import { readGovernancePolicyForOrg } from '../lib/org-config.ts';
import { readUserMemberRows } from './membership.ts';
import { authRequestCache } from './request-cache.ts';

/**
 * Two refresh cadences under one Better Auth config (#5164).
 *
 * Better Auth refreshes a session — writes its `expiresAt` and `updatedAt` —
 * at its first request once `expiresAt - expiresIn + updateAge` has passed,
 * and nothing else records that a session was used. The idle sweep
 * (`domains/governance/session-idle.ts`) reads `updatedAt` as the session's
 * last use, so how often that write happens is how closely the sweep tells
 * an idle session from one in use.
 *
 * With `SESSION_IDLE_TIMEOUT_MINUTES` unset, `updateAge` is five minutes, so
 * a session no idle window covers costs a write every five minutes. A
 * session whose user an organization's window covers has its expiry written
 * {@link SessionRefreshShape.advance} earlier at every sign-in and refresh,
 * which brings its next refresh to a minute after the write: the
 * minute-accurate `updatedAt` the sweep needs. The session hooks in
 * `auth.ts` ask {@link sessionExpiryToWrite} at each such write.
 *
 * The sweep tells the two kinds apart by their own columns —
 * `expiresAt - updatedAt` is `expiresIn` for the five-minute kind and
 * `expiresIn - advance` for the one-minute kind — and grants a five-minute
 * session the five minutes of use its `updatedAt` may not show. A hook that
 * answered wrong, or a window that came into force after the write, costs
 * at most that, never a session in use.
 *
 * With the variable set, every session is under its window and `updateAge`
 * is a minute at most: the advance is zero and nothing here acts.
 */

/**
 * Whether an idle window covers the user: a membership, not disabled, in an
 * organization whose effective window is on — the shared resolver over the
 * same policy reads the sweep makes, so the two agree on who is covered.
 * The member rows come through the process's cache where one runs.
 */
export async function userUnderIdleWindow(
  sql: Sql,
  userId: string,
): Promise<boolean> {
  const cache = authRequestCache();
  const read = async () => readUserMemberRows(sql, userId);
  const rows =
    cache === null ? await read() : await cache.memberships(userId, read);
  const envMinutes = parseSessionIdleTimeoutMinutes();
  for (const row of rows) {
    if (row.role.toLowerCase() === 'disabled') continue;
    const policy = await readGovernancePolicyForOrg(
      sql,
      row.organizationId,
      'session_idle_timeout',
    );
    const minutes = resolveEffectiveIdleMinutes({ policy, envMinutes });
    if (minutes !== null && minutes > 0) return true;
  }
  return false;
}

/**
 * The expiry a sign-in or refresh writes, given the one Better Auth chose
 * at `now`: {@link SessionRefreshShape.advance} earlier when an idle window
 * covers the user, so the session refreshes every minute. Only a write that
 * gives the session Better Auth's full lifetime moves: a shorter one (a
 * "don't remember me" sign-in) is never refreshed or falls due at once, and
 * keeps its expiry.
 *
 * When the user is unknown or the check fails, the session refreshes every
 * minute, as every session did before #5164, and the write goes on.
 */
export async function sessionExpiryToWrite(
  sql: Sql,
  write: { userId: string | null; expiresAt: Date; now: number },
  shape: SessionRefreshShape = sessionRefreshShape(),
): Promise<Date> {
  if (shape.advance <= 0) return write.expiresAt;
  const lifetimeMs = write.expiresAt.getTime() - write.now;
  if (lifetimeMs <= (shape.expiresIn - shape.advance) * 1000) {
    return write.expiresAt;
  }
  let covered = true;
  if (write.userId === null) {
    console.warn(
      '[session-refresh] a session write names no user: refreshing it every minute',
    );
  } else {
    try {
      covered = await userUnderIdleWindow(sql, write.userId);
    } catch (error) {
      console.warn(
        '[session-refresh] idle window check failed: refreshing the session every minute',
        error,
      );
    }
  }
  return covered
    ? new Date(write.expiresAt.getTime() - shape.advance * 1000)
    : write.expiresAt;
}
