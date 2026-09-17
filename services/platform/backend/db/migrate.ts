import { readdir, readFile } from 'node:fs/promises';

import type { BetterAuthOptions } from 'better-auth';
import postgres from 'postgres';

import { resolvePostgresConnection } from './ssl.ts';

/**
 * Boot-time migrator for the 0.5 app database.
 *
 * Two phases, both inside ONE session-scoped Postgres advisory lock so N
 * concurrently booting containers (api + worker, or scaled replicas) apply
 * everything exactly once while the others wait:
 *   1. App SQL migrations — plain .sql files in ./migrations, applied in
 *      filename order, each in its own transaction, tracked in
 *      `app_migrations` (dbmate-style, mirroring services/db's knowledge-DB
 *      approach).
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

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

export async function runBootMigrations(
  options: BootMigrationOptions,
): Promise<void> {
  const log = options.log ?? ((message: string) => console.log(message));
  // Dedicated single-connection client: the advisory lock is session-scoped,
  // so the lock lives exactly as long as this connection.
  const { url, ssl } = resolvePostgresConnection(options.databaseUrl);
  const sql = postgres(url, {
    max: 1,
    ssl,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

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
      const ddl = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      log(`[backend] applying app migration ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
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
      await verifyProvisionedAccounts(sql, log);
    }
  } finally {
    // Session lock releases with the connection either way; explicit unlock
    // keeps the happy path tidy.
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(
      (error: unknown) => {
        console.warn('[backend] advisory unlock failed (ignored):', error);
      },
    );
    await sql.end({ timeout: 5 });
  }
}
