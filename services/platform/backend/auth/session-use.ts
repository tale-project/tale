import { sessionIdleWindowSeconds } from '@tale/shared/utils/session-idle';
import type { Sql, TransactionSql } from 'postgres';

/**
 * A session's last use, as the idle sweep reads it: `session.updatedAt`
 * (`domains/governance/session-idle.ts`).
 *
 * Better Auth writes it only when it slides a row's expiry, once the row is
 * within `expiresIn` of its end. A row minted for longer than that waits
 * weeks for its first slide (single sign-on's 30 days against the 7-day
 * default), and a "don't remember me" row never slides: in use or not, such
 * a row reads as last used at sign-in, and an organization's idle window
 * signs its person out one window later. So every authorization records the
 * use on the row itself (`session-authority.ts`), and never its expiry: a
 * session keeps the lifetime it was minted with.
 */

/** However the refresh cadence is tuned, the sweep sees a session in use as
 * last used no longer than this ago. */
export const SESSION_USE_STAMP_MAX_SECONDS = 60;

/** How old a recorded use may get before a request records a new one:
 * Better Auth's refresh cadence (`updateAge`), at most a minute. */
export function sessionUseStampSeconds(
  updateAge: number = sessionIdleWindowSeconds().updateAge,
): number {
  return Math.min(updateAge, SESSION_USE_STAMP_MAX_SECONDS);
}

/** Record a use the server has just authorized with the browser row
 * `sessionId`, whose recorded use is `lastUse`. One conditional write a
 * minute at most, whichever request gets there first; it writes
 * `updatedAt` alone, which the auth cache's log leaves out
 * (`db/auth-invalidation-triggers.ts`). A failure leaves the request
 * authorized: the next one records the use. */
export async function stampSessionUse(
  sql: Sql | TransactionSql,
  sessionId: string,
  lastUse: Date,
  now: number = Date.now(),
): Promise<void> {
  const due = now - sessionUseStampSeconds() * 1000;
  if (lastUse.getTime() > due) return;
  try {
    await sql`
      UPDATE "session" SET "updatedAt" = ${new Date(now)}
      WHERE "id" = ${sessionId} AND "updatedAt" <= ${new Date(due)}
    `;
  } catch (error) {
    console.warn('[session-use] could not record a session use:', error);
  }
}
