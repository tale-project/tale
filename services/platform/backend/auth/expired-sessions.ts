import type { Sql } from 'postgres';

/**
 * The expired-session reaper — the daily `maintenance.expired_sessions` job.
 *
 * Better Auth drops an expired `"session"` row only when that session is
 * presented again: the lookup finds it past `"expiresAt"`, clears the cookie
 * and deletes the row. A session nobody presents again — a closed browser, a
 * cleared cookie, a retired laptop, an idle window that ran out overnight —
 * stays in the table for good, token, IP address and user agent included.
 * The idle-revocation sweep (`domains/governance/session-idle.ts`) leaves an
 * expired row alone on purpose, and the trusted-header door mints a fresh
 * session beside an expired one rather than deleting it, so no other sweep
 * removes one. The pile also crowds the idle sweep itself: it reads a
 * bounded window of the least recently used sessions, and an expired row
 * takes a place there without ever qualifying.
 *
 * Deleting a row this far past its expiry does early what Better Auth would
 * do on the next read, and changes no answer: the `/events` re-check
 * (`realtime/sse.ts`) and the trusted-header door's reuse test already treat
 * an expired session as absent, and the OAuth token tables reference a
 * session `ON DELETE SET NULL`.
 */

/**
 * How long past its expiry a row is kept. Better Auth and the trusted-header
 * door judge expiry on the API host's clock and may extend a session they
 * read as live, while this sweep runs on the worker's; a day of margin keeps
 * clock skew between the two from ever deleting a row a request is
 * extending. It stays a day and no more: an expired row serves nobody, and it
 * still carries the IP address and user agent of the sign-in.
 */
export const EXPIRED_SESSION_GRACE_MS = 24 * 3_600_000;

/** Rows one DELETE removes, so no statement holds the table for long. */
export const EXPIRED_SESSION_BATCH = 1_000;

/**
 * DELETE rounds one run may take. A backlog larger than this — the first run
 * on a deployment that has collected years of rows — drains over the
 * following nights instead of in one long job.
 */
export const EXPIRED_SESSION_MAX_BATCHES = 100;

export interface ExpiredSessionReap {
  /** Rows this run deleted. */
  deleted: number;
  /** False when the run stopped with rows possibly left: it spent its batch
   * budget or was aborted. The next run carries on. */
  drained: boolean;
}

export async function reapExpiredSessions(
  sql: Sql,
  options: {
    now?: number;
    graceMs?: number;
    batch?: number;
    maxBatches?: number;
    /** Stops the run between batches (the job's expiry or a shutdown). */
    signal?: AbortSignal;
  } = {},
): Promise<ExpiredSessionReap> {
  const now = options.now ?? Date.now();
  const cutoff = new Date(now - (options.graceMs ?? EXPIRED_SESSION_GRACE_MS));
  const batch = options.batch ?? EXPIRED_SESSION_BATCH;
  const maxBatches = options.maxBatches ?? EXPIRED_SESSION_MAX_BATCHES;
  let deleted = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    if (options.signal?.aborted === true) return { deleted, drained: false };
    // `SKIP LOCKED`: a row another transaction holds — a sign-in or a member
    // removal touching the same user — is left for the next run rather than
    // waited on.
    const result = await sql`
      DELETE FROM "session"
      WHERE "id" IN (
        SELECT "id" FROM "session"
        WHERE "expiresAt" < ${cutoff}
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      )
    `;
    deleted += result.count;
    if (result.count < batch) return { deleted, drained: true };
  }
  return { deleted, drained: false };
}
