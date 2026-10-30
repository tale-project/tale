import type postgres from 'postgres';

import { isDatabaseUnavailable } from './unavailable.ts';

/**
 * The indexes boot adds to Better Auth's tables, which Better Auth's own
 * schema does not declare:
 *
 *  - `user_email_lower_idx`, the case-folded address every sign-in looks its
 *    user up by. The sign-in hooks (`domains/login_attempts`), the member and
 *    user doors and the owner checks all match `lower("email")`, while Better
 *    Auth only declares a unique index on the raw column — so each of those
 *    lookups read the whole `user` table, which at a million users costs a
 *    sequential scan per sign-in and turns a morning sign-in wave into a
 *    queue.
 *  - `session_expiresAt_idx`, which the expired-session reaper
 *    (`auth/expired-sessions.ts`) takes its batches by.
 *  - `session_updatedAt_expiresAt_idx`, which the idle-session sweep
 *    (`domains/governance/session-idle.ts`) walks, least recently used
 *    first: ordered by its first column and filtered by its second inside
 *    the index, so an expired row the reaper has not taken yet costs the
 *    sweep no table read.
 *
 * Without the two session indexes every batch of either sweep reads the
 * whole `session` table. Their price: Better Auth's refresh slides
 * `"expiresAt"` and `"updatedAt"`, so it is no longer a HOT update and
 * writes every index of the table.
 *
 * The names are the ones Better Auth gives its own (`<table>_<columns>_idx`):
 * its migrator matches the indexes it declares by name and leaves one alone
 * whose columns match, so should it ever declare one of these, it finds it
 * built.
 *
 * Built CONCURRENTLY so a live deployment keeps signing people in while a
 * new image builds them mid-roll, which also means they cannot be built
 * inside a transaction (this boot step runs on the migrator's autocommit
 * session). A concurrent build waits for every transaction holding a
 * snapshot, so it runs only AFTER the migration lock is released: a second
 * booting replica waits for that lock inside a statement, and a build under
 * the lock would wait for that very statement — a deadlock. One replica
 * builds, under a lock nobody waits for; the others skip, so none mistakes a
 * build in progress (an INVALID index until it completes) for an interrupted
 * one. A build that died — a crash, a restart mid-roll — leaves an INVALID
 * index that `IF NOT EXISTS` would keep forever; the next boot drops it and
 * builds again. A failed build is reported, never fatal, and does not stop
 * the others: without its index a reader only runs slower. Not a numbered
 * migration for the same reason `defaultTeamMemberCount` (`db/migrate.ts`)
 * is not: the `.sql` files run before Better Auth's tables exist.
 */
export const BOOT_INDEXES = [
  'user_email_lower_idx',
  'session_expiresAt_idx',
  'session_updatedAt_expiresAt_idx',
] as const;

type BootIndex = (typeof BOOT_INDEXES)[number];

/**
 * Held (never waited for) by the one process building the indexes. It was
 * the e-mail index's alone before the session indexes joined it, so an image
 * from before them still keeps a build of this one out mid-roll.
 */
const BOOT_INDEX_LOCK_KEY = 72_085_003;

const CREATE: Record<
  BootIndex,
  (sql: postgres.Sql) => postgres.PendingQuery<postgres.Row[]>
> = {
  user_email_lower_idx: (sql) => sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_idx"
    ON "user" (lower("email"))
  `,
  session_expiresAt_idx: (sql) => sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_expiresAt_idx"
    ON "session" ("expiresAt")
  `,
  session_updatedAt_expiresAt_idx: (sql) => sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "session_updatedAt_expiresAt_idx"
    ON "session" ("updatedAt", "expiresAt")
  `,
};

/** Build each boot index that is missing or was left INVALID. */
export async function buildBootIndexes(
  sql: postgres.Sql,
  log: (message: string) => void,
): Promise<void> {
  const [claim] = await sql<{ claimed: boolean }[]>`
    SELECT pg_try_advisory_lock(${BOOT_INDEX_LOCK_KEY}) AS claimed
  `;
  if (!claim?.claimed) return;
  try {
    for (const name of BOOT_INDEXES) await buildIndex(sql, name, log);
  } finally {
    await sql`SELECT pg_advisory_unlock(${BOOT_INDEX_LOCK_KEY})`.catch(
      (error: unknown) => {
        console.warn('[backend] boot index unlock failed (ignored):', error);
      },
    );
  }
}

async function buildIndex(
  sql: postgres.Sql,
  name: BootIndex,
  log: (message: string) => void,
): Promise<void> {
  try {
    // Resolved through the search path, like Better Auth's own unqualified
    // tables: they land in the first schema of it (`tale` on the tale-db
    // image, `public` on a plain Postgres), and an index lives beside its
    // table.
    const existing = await sql<{ valid: boolean }[]>`
      SELECT i.indisvalid AS valid
      FROM pg_index i
      WHERE i.indexrelid = to_regclass(${`"${name}"`})
    `;
    if (existing[0]?.valid) return;
    if (existing[0] !== undefined) {
      log(`[backend] rebuilding the interrupted index ${name}`);
      await sql`DROP INDEX CONCURRENTLY IF EXISTS ${sql(name)}`;
    }
    log(`[backend] building the index ${name}`);
    await CREATE[name](sql);
  } catch (error) {
    if (isDatabaseUnavailable(error, { fromDatabase: true })) throw error;
    console.warn(
      `[backend] the index ${name} was not built; the next boot retries:`,
      error,
    );
  }
}
