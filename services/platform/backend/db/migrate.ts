import { readdir, readFile } from 'node:fs/promises';

import { withRetry } from '@tale/shared/db/retry';
import type { BetterAuthOptions } from 'better-auth';
import postgres from 'postgres';

import { resolvePostgresConnection } from './ssl.ts';
import { isDatabaseUnavailable, ROUTINE_RESTART_MS } from './unavailable.ts';

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
export function isMigrationFile(name: string): boolean {
  if (name.endsWith('.sql')) return true;
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    !name.endsWith('.d.ts')
  );
}

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
async function applyMigrationFile(
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
        await applyMigrationFile(tx, file);
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
    }
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
