import type postgres from 'postgres';

/**
 * The triggers that feed `app_realtime.auth_invalidations` (migration 0195)
 * from Better Auth's `session`, `user` and `member` tables — what lets an
 * API process answer sessions and memberships from memory
 * (`auth/request-cache.ts`), which stays off while any of them is missing.
 *
 * Installed by boot, after Better Auth's migrator (`db/migrate.ts`): the
 * numbered `.sql` files run before Better Auth creates its tables on a fresh
 * database. Only a missing trigger is created, so a routine boot takes no
 * lock on the busiest table there is; a definition that changes takes a new
 * name. A session update that only slides its expiry — Better Auth's
 * refresh, which writes `expiresAt` and `updatedAt` and nothing else — writes
 * no row: a cached session stops answering when that refresh falls due
 * anyway.
 */
export const AUTH_INVALIDATION_TRIGGERS = [
  'auth_session_deleted',
  'auth_session_updated',
  'auth_user_changed',
  'auth_member_changed',
] as const;

type TriggerName = (typeof AUTH_INVALIDATION_TRIGGERS)[number];

/** How long the install waits for a table's lock before it gives up. */
const INSTALL_LOCK_TIMEOUT = '10s';

const CREATE: Record<
  TriggerName,
  (tx: postgres.TransactionSql) => postgres.PendingQuery<postgres.Row[]>
> = {
  auth_session_deleted: (tx) => tx`
    CREATE OR REPLACE TRIGGER auth_session_deleted
    AFTER DELETE ON "session"
    FOR EACH ROW EXECUTE FUNCTION app_realtime.auth_session_changed()
  `,
  auth_session_updated: (tx) => tx`
    CREATE OR REPLACE TRIGGER auth_session_updated
    AFTER UPDATE ON "session"
    FOR EACH ROW
    WHEN ((to_jsonb(OLD) - ARRAY['expiresAt', 'updatedAt'])
      IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['expiresAt', 'updatedAt']))
    EXECUTE FUNCTION app_realtime.auth_session_changed()
  `,
  auth_user_changed: (tx) => tx`
    CREATE OR REPLACE TRIGGER auth_user_changed
    AFTER UPDATE OR DELETE ON "user"
    FOR EACH ROW EXECUTE FUNCTION app_realtime.auth_user_changed()
  `,
  auth_member_changed: (tx) => tx`
    CREATE OR REPLACE TRIGGER auth_member_changed
    AFTER INSERT OR UPDATE OR DELETE ON "member"
    FOR EACH ROW EXECUTE FUNCTION app_realtime.auth_member_changed()
  `,
};

/** The triggers present, enabled, on the public schema's tables. */
export async function presentAuthInvalidationTriggers(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`
    SELECT t.tgname AS name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
      AND n.nspname = 'public'
      AND t.tgname = ANY(${[...AUTH_INVALIDATION_TRIGGERS]})
  `;
  return new Set(rows.map((row) => row.name));
}

/**
 * Create the triggers that are missing. One that cannot be created — its
 * table's lock held past {@link INSTALL_LOCK_TIMEOUT} by a long transaction
 * — is reported, never fatal: the caches stay off until a later boot has
 * installed it, and every request reads the database as before.
 */
export async function installAuthInvalidationTriggers(
  sql: postgres.Sql,
  log: (message: string) => void,
): Promise<void> {
  const present = await presentAuthInvalidationTriggers(sql);
  for (const name of AUTH_INVALIDATION_TRIGGERS) {
    if (present.has(name)) continue;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('lock_timeout', ${INSTALL_LOCK_TIMEOUT}, true)`;
        await CREATE[name](tx);
      });
      log(`[backend] installed auth invalidation trigger ${name}`);
    } catch (error) {
      console.error(
        `[backend] auth invalidation trigger ${name} could not be installed; sessions and memberships are read on every request until a later boot installs it:`,
        error,
      );
    }
  }
}
