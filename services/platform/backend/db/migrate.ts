import { readdir, readFile } from 'node:fs/promises';

import { isMigrationFile } from '@tale/shared/db/migration-files';
import { withRetry } from '@tale/shared/db/retry';
import type { BetterAuthOptions } from 'better-auth';
import postgres from 'postgres';

import { installAuthInvalidationTriggers } from './auth-invalidation-triggers.ts';
import { resolvePostgresConnection } from './ssl.ts';
import { isDatabaseUnavailable, ROUTINE_RESTART_MS } from './unavailable.ts';

export { isMigrationFile } from '@tale/shared/db/migration-files';

/**
 * Boot-time migrator for the 0.5 app database.
 *
 * Two phases, both inside ONE session-scoped Postgres advisory lock so N
 * concurrently booting containers (api + worker, or scaled replicas) apply
 * everything exactly once while the others wait:
 *   1. App migrations — numbered files in ./migrations, applied in filename
 *      order, each in its own transaction, tracked in `app_migrations`
 *      (dbmate-style, mirroring services/db's knowledge-DB approach). A
 *      migration is a plain .sql file, or a .ts DATA migration (see
 *      {@link DataMigration}) when a backfill has to decide with the app's
 *      own code.
 *   2. Better Auth's own schema migrations (when an auth-configured caller
 *      passes `authOptions`) — Better Auth owns its tables the same way
 *      pg-boss owns `pgboss`.
 *
 * pg-boss is NOT migrated here: it migrates its own schema on
 * start, holding its own locks.
 */

/** Arbitrary-but-fixed app-wide advisory lock key for boot migrations. */
const MIGRATION_LOCK_KEY = 72_085_001;
/** Held (never waited for) by the one process building the e-mail index. */
const EMAIL_INDEX_LOCK_KEY = 72_085_003;

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export interface BootMigrationOptions {
  databaseUrl: string;
  /**
   * A Better Auth options object (from `createAuth(...).options`); omitted by
   * roles that boot without auth configuration — the api role then owns the
   * auth-table migrations.
   */
  authOptions?: BetterAuthOptions;
  log?: (message: string) => void;
  /**
   * How long an unavailable database is waited out, timed from its first
   * refusal, before the step gives up; {@link ROUTINE_RESTART_MS} by default.
   */
  databaseWaitMs?: number;
  /** The pause between two attempts (injectable for deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The outage's clock, in milliseconds: monotonic `performance.now()` by
   * default, so a wall-clock step as the host syncs its time at boot neither
   * cuts the wait short nor stretches it (injectable for deterministic tests).
   */
  now?: () => number;
}

/** The first pause after an attempt the database was unavailable for; it
 * doubles from here up to {@link DATABASE_RETRY_MAX_DELAY_MS}. */
const DATABASE_RETRY_BASE_DELAY_MS = 1_000;

/** The longest pause between two attempts — how late a booting process at
 * most notices that the database is back. */
const DATABASE_RETRY_MAX_DELAY_MS = 5_000;

/**
 * Give Better Auth's `team.memberCount` a SQL default.
 *
 * 1.7 added the column as NOT NULL with an application-level `defaultValue`
 * only — its own adapter always supplies a value, so it emits no SQL DEFAULT.
 * This deployment owns team membership in plain SQL instead (`domains/scim`,
 * `domains/sso`, the teams domain) and never calls Better Auth's team API, so
 * every one of those inserts would fail the not-null constraint. Defaulting
 * the column fixes the whole class at once rather than threading a bookkeeping
 * value through each caller.
 *
 * The value stays 0 and is deliberately NOT maintained: nothing here reads it.
 * The Teams surfaces count `teamMember` live
 * (`domains/teams/service.ts`), which cannot drift. Should anything ever start
 * calling Better Auth's team endpoints, this column has to be maintained
 * first.
 *
 * Not a numbered migration, for the same reason `verifyProvisionedAccounts`
 * is not: the app's `.sql` files run before Better Auth's tables exist. Runs
 * every boot; `IF EXISTS` and `SET DEFAULT` are both idempotent, and Better
 * Auth's migrator only adds missing tables and columns, so it never takes the
 * default back off.
 */
async function defaultTeamMemberCount(sql: postgres.Sql): Promise<void> {
  await sql`
    ALTER TABLE IF EXISTS "team"
    ALTER COLUMN "memberCount" SET DEFAULT 0
  `;
}

/**
 * Index the case-folded address every sign-in looks its user up by.
 *
 * The sign-in hooks (`domains/login_attempts`), the member and user doors
 * and the owner checks all match `lower("email")`, while Better Auth only
 * declares a unique index on the raw column — so each of those lookups read
 * the whole `user` table, which at a million users costs a sequential scan
 * per sign-in and turns a morning sign-in wave into a queue.
 *
 * Built CONCURRENTLY so a live deployment keeps signing people up while a
 * new image builds it mid-roll, which also means it cannot run inside a
 * transaction (this boot step runs on the migrator's autocommit session).
 * A concurrent build waits for every transaction holding a snapshot, so it
 * runs only AFTER the migration lock is released: a second booting replica
 * waits for that lock inside a statement, and a build under the lock would
 * wait for that very statement — a deadlock. One replica builds, under a
 * lock nobody waits for; the others skip, so none mistakes the build in
 * progress (an INVALID index until it completes) for an interrupted one.
 * A build that died — a crash, a restart mid-roll — leaves an INVALID index
 * that `IF NOT EXISTS` would keep forever; the next boot drops it and builds
 * again. A failed build is reported, never fatal: sign-in only runs slower
 * without the index. Not a numbered migration for the same reason
 * `defaultTeamMemberCount` is not: the `.sql` files run before Better
 * Auth's tables exist.
 */
async function indexUserEmailLower(
  sql: postgres.Sql,
  log: (message: string) => void,
): Promise<void> {
  const [claim] = await sql<{ claimed: boolean }[]>`
    SELECT pg_try_advisory_lock(${EMAIL_INDEX_LOCK_KEY}) AS claimed
  `;
  if (!claim?.claimed) return;
  try {
    // Resolved through the search path, like Better Auth's own unqualified
    // tables: they land in the first schema of it (`tale` on the tale-db
    // image, `public` on a plain Postgres), and an index lives beside its
    // table.
    const existing = await sql<{ valid: boolean }[]>`
      SELECT i.indisvalid AS valid
      FROM pg_index i
      WHERE i.indexrelid = to_regclass('"user_email_lower_idx"')
    `;
    if (existing[0]?.valid) return;
    if (existing[0] !== undefined) {
      log('[backend] rebuilding an interrupted user e-mail index');
      await sql`DROP INDEX CONCURRENTLY IF EXISTS "user_email_lower_idx"`;
    }
    log('[backend] indexing user e-mail addresses for sign-in');
    await sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_email_lower_idx"
      ON "user" (lower("email"))
    `;
  } catch (error) {
    if (isDatabaseUnavailable(error, { fromDatabase: true })) throw error;
    console.warn(
      '[backend] the user e-mail index was not built; the next boot retries:',
      error,
    );
  } finally {
    await sql`SELECT pg_advisory_unlock(${EMAIL_INDEX_LOCK_KEY})`.catch(
      (error: unknown) => {
        console.warn('[backend] e-mail index unlock failed (ignored):', error);
      },
    );
  }
}

/**
 * Catch up accounts this deployment provisioned before a provisioned account
 * counted as a verified one (`backend/auth/auth.ts`). A `credential` row is
 * the proof: it exists only for an account whose password this instance
 * issued — the first owner, a member an admin added, the operator's deploy.
 * A directory-provisioned account (SSO, SCIM, trusted headers) has no such
 * row and keeps its provider's verdict.
 *
 * Not a numbered migration: the app's `.sql` files run before Better Auth's
 * own tables exist, and they are not the app's to write. It runs on every
 * boot rather than once, because during a rolling deploy the previous image
 * keeps creating unverified accounts while the new one is already up — the
 * statement matches nothing once they are all verified.
 */
async function verifyProvisionedAccounts(
  sql: postgres.Sql,
  log: (message: string) => void,
): Promise<void> {
  const caught = await sql`
    UPDATE "user" AS u SET "emailVerified" = true
    WHERE u."emailVerified" = false
      AND EXISTS (
        SELECT 1 FROM "account" AS a
        WHERE a."userId" = u."id" AND a."providerId" = 'credential'
      )
  `;
  if (caught.count > 0) {
    log(`[backend] verified ${caught.count} provisioned account(s)`);
  }
}

/** The `app.boot_repairs` name of {@link revokeClientWrittenTrustFields}. */
const REVOKE_CLIENT_TRUST_FIELDS = 'revoke-client-written-trust-fields';

/**
 * Sign out, once, every session that carries trusted-headers fields, so each
 * is minted again by the trusted-headers door — the only writer of those
 * fields from now on (`backend/auth/auth.ts`). A proxy's users get a fresh
 * session through the proxy's sign-in hand-off on their next visit; anyone
 * else signs in again.
 *
 * Recorded in `app.boot_repairs` (0193) so it runs once per database: the
 * sessions are Better Auth's, and exist only after its migrator ran.
 */
async function revokeClientWrittenTrustFields(
  sql: postgres.Sql,
  log: (message: string) => void,
): Promise<void> {
  await sql.begin(async (tx) => {
    const recorded = await tx`
      INSERT INTO app.boot_repairs (name) VALUES (${REVOKE_CLIENT_TRUST_FIELDS})
      ON CONFLICT (name) DO NOTHING
      RETURNING name
    `;
    if (recorded.length === 0) return;
    const revoked = await tx`
      DELETE FROM "session"
      WHERE "trustedRole" IS NOT NULL OR "trustedOrganizationId" IS NOT NULL
    `;
    if (revoked.count > 0) {
      log(
        `[backend] reset ${revoked.count} session(s) carrying a trusted role`,
      );
    }
  });
}

/**
 * A numbered `.ts` migration: a DATA migration whose decision is a rule the
 * application already owns — a backfill keyed on which files an extractor
 * reads calls `isSupported()`, where a SQL copy of the extension set would
 * be a second copy, frozen here while the real one moves on. The module
 * exports `migrate`, which runs inside the migration's own transaction,
 * after every file numbered before it and before every file after it, and
 * is recorded in `app_migrations` by filename like a `.sql` file. It must be
 * idempotent and leave the previous image working, like any migration.
 *
 * It runs against the schema as it stood at its own number, but with the
 * code of whichever image applies it — a database that jumps past several
 * releases runs it with the newest. So the module writes every statement it
 * runs itself (the reads, the writes, an `EXISTS` over `app.documents`, the
 * realtime hint's `INSERT`) and imports only PURE rules: code that decides
 * from its arguments and runs no SQL and no I/O (`isSupported()`, the
 * `RAG_ERROR_*` codes, a sentence helper). Never a domain service, the
 * realtime outbox, a job helper or anything else that follows today's
 * schema: a later release that reshapes a table and updates that helper
 * would run the new SQL on the old table. `db/data-migrations.test.ts` walks
 * every data migration's imports and fails on a module outside its list of
 * pure rules, or a package outside its list of pure packages.
 */
export interface DataMigration {
  migrate(tx: postgres.TransactionSql): Promise<void>;
}

/** The files the migrator applies: `.sql`, and `.ts` data migrations — never
 * a test or a declaration file beside them. */
async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter(isMigrationFile).sort();
}

function isDataMigration(value: unknown): value is DataMigration {
  return (
    typeof value === 'object' &&
    value !== null &&
    'migrate' in value &&
    typeof value.migrate === 'function'
  );
}

/** Apply one migration file inside the transaction that records it. */
export async function applyMigrationFileInTx(
  tx: postgres.TransactionSql,
  file: string,
): Promise<void> {
  const url = new URL(file, MIGRATIONS_DIR);
  if (file.endsWith('.sql')) {
    await tx.unsafe(await readFile(url, 'utf8'));
    return;
  }
  const module: unknown = await import(url.href);
  if (!isDataMigration(module)) {
    throw new Error(
      `[backend] app migration ${file} does not export migrate(tx)`,
    );
  }
  await module.migrate(tx);
}

/**
 * Apply every pending migration — the boot process's first use of the
 * database.
 *
 * A database that is unavailable meanwhile — restarting, still starting, a
 * container restarted while `db` restarts, a host boot racing it — is waited
 * out like a restart anywhere else (`db/unavailable.ts`): the whole step runs
 * again with backoff while it fails that way, until `databaseWaitMs` has
 * passed since the first refusal. Time spent queued behind another process's
 * lock, or applying migrations, before that refusal does not count. The
 * clock is one per boot, deliberately: a second outage in the same boot
 * shares it, the time between the two included, so a database that keeps
 * going away cannot hold the boot without it ever being reported. Running
 * the step again is what a restarted process did anyway: the advisory lock
 * belongs to the session, each app migration commits together with its
 * tracking row or not at all, and Better Auth's migrator adds the tables and
 * columns still missing. Any other failure (rejected credentials, a missing
 * database, a migration that does not apply) and an outage that outlasts the
 * wait reject as before, and the boot reports the error and exits.
 */
export async function runBootMigrations(
  options: BootMigrationOptions,
): Promise<void> {
  const log = options.log ?? ((message: string) => console.log(message));
  const waitMs = options.databaseWaitMs ?? ROUTINE_RESTART_MS;
  const clock = options.now ?? (() => performance.now());
  let outageSince: number | null = null;
  await withRetry(() => migrateOnce(options, log), {
    // The outage's clock below, not a count or a budget, ends the retries.
    attempts: Number.POSITIVE_INFINITY,
    timeoutMs: Number.POSITIVE_INFINITY,
    baseDelayMs: DATABASE_RETRY_BASE_DELAY_MS,
    maxDelayMs: DATABASE_RETRY_MAX_DELAY_MS,
    isTransient: (error) => {
      // Every client this step opens is a database client, so a bare socket
      // error from Better Auth's node-postgres migrator is the database's too.
      if (!isDatabaseUnavailable(error, { fromDatabase: true })) return false;
      const now = clock();
      outageSince ??= now;
      return now - outageSince < waitMs;
    },
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
}

async function migrateOnce(
  options: BootMigrationOptions,
  log: (message: string) => void,
): Promise<void> {
  // Dedicated single-connection client: the advisory lock is session-scoped,
  // so the lock lives exactly as long as this connection.
  const { url, ssl } = resolvePostgresConnection(options.databaseUrl);
  const sql = postgres(url, {
    max: 1,
    ssl,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  let locked = false;
  let failure: unknown;
  try {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;

    await sql`
      CREATE TABLE IF NOT EXISTS app_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const appliedRows = await sql<{ name: string }[]>`
      SELECT name FROM app_migrations
    `;
    const applied = new Set(appliedRows.map((row) => row.name));

    for (const file of await listMigrationFiles()) {
      if (applied.has(file)) {
        continue;
      }
      log(`[backend] applying app migration ${file}`);
      await sql.begin(async (tx) => {
        await applyMigrationFileInTx(tx, file);
        await tx`INSERT INTO app_migrations (name) VALUES (${file})`;
      });
    }

    if (options.authOptions) {
      // Imported lazily so worker-only processes without auth config never
      // load the auth stack.
      const { getMigrations } = await import('better-auth/db/migration');
      const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
        options.authOptions,
      );
      if (toBeCreated.length > 0 || toBeAdded.length > 0) {
        log(
          `[backend] applying better-auth migrations (create=${toBeCreated.length}, add=${toBeAdded.length})`,
        );
        await runMigrations();
      }
      await defaultTeamMemberCount(sql);
      await verifyProvisionedAccounts(sql, log);
      await revokeClientWrittenTrustFields(sql, log);
      await installAuthInvalidationTriggers(sql, log);
    }
    // The e-mail index builds concurrently, which must not happen under
    // this lock (see `indexUserEmailLower`).
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    locked = false;
    if (options.authOptions) await indexUserEmailLower(sql, log);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Session lock releases with the connection either way; explicit unlock
    // keeps the happy path tidy. A lock never taken has nothing to release,
    // and after a failure that says the database is away the unlock would
    // only open a new connection to it — ending the session below releases
    // the lock just the same.
    if (locked && !isDatabaseUnavailable(failure, { fromDatabase: true })) {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(
        (error: unknown) => {
          console.warn('[backend] advisory unlock failed (ignored):', error);
        },
      );
    }
    await sql.end({ timeout: 5 });
  }
}
