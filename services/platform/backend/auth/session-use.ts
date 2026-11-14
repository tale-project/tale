import { sessionIdleWindowSeconds } from '@tale/shared/utils/session-idle';
import type { Sql, TransactionSql } from 'postgres';

import { sessionCookieCacheSeconds } from './session-cache.ts';

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

/** The browser row as the stamp reads it: its recorded use and its expiry. */
export interface SessionUseRow {
  updatedAt: Date;
  expiresAt: Date;
}

/** Slack on each comparison, so a refresh landing a moment late still counts. */
const SESSION_USE_SLACK_MS = 1_000;

/** Whether Better Auth's own refresh of `row` records a use in time, so the
 * stamp need not write. Better Auth's first refresh of the row is due at
 * `slideAt`, its expiry less the lifetime it refreshes back to, plus the
 * cadence. It records the use in time when that moment is no later than a
 * stamp would write (`updatedAt + updateAge`), and not overdue by more than
 * the cookie cache, which defers it. A single sign-on row fails the first
 * test (its slide is weeks away), a "don't remember me" row the second (Better
 * Auth never refreshes it), and a regular row passes both. */
export function betterAuthRecordsUseInTime(
  row: SessionUseRow,
  now: number,
  {
    expiresIn,
    updateAge,
  }: { expiresIn: number; updateAge: number } = sessionIdleWindowSeconds(),
  cookieCacheSeconds: number = sessionCookieCacheSeconds(),
): boolean {
  const slideAt = row.expiresAt.getTime() - (expiresIn - updateAge) * 1000;
  return (
    slideAt <=
      row.updatedAt.getTime() + updateAge * 1000 + SESSION_USE_SLACK_MS &&
    slideAt >= now - cookieCacheSeconds * 1000 - SESSION_USE_SLACK_MS
  );
}

/** Record a use the server has just authorized with the browser row
 * `sessionId`, whose recorded use and expiry are `row`. Where Better Auth's
 * refresh will not record it in time, one conditional write a minute at
 * most, whichever request gets there first; it writes `updatedAt` alone,
 * which the auth cache's log leaves out (`db/auth-invalidation-triggers.ts`).
 * A failure leaves the request authorized: the next one records the use. */
export async function stampSessionUse(
  sql: Sql | TransactionSql,
  sessionId: string,
  row: SessionUseRow,
  now: number = Date.now(),
): Promise<void> {
  if (betterAuthRecordsUseInTime(row, now)) return;
  const due = now - sessionUseStampSeconds() * 1000;
  if (row.updatedAt.getTime() > due) return;
  try {
    await sql`
      UPDATE "session" SET "updatedAt" = ${new Date(now)}
      WHERE "id" = ${sessionId} AND "updatedAt" <= ${new Date(due)}
    `;
  } catch (error) {
    console.warn('[session-use] could not record a session use:', error);
  }
}
