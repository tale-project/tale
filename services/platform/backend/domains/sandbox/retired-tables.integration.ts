/** Real Postgres proof that migration 0123 dropped the retired sandbox tables. */
import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);
const CREATED_BY = '0017_sandbox_sessions.sql';
const DROPPED_BY = '0123_sandbox_retired_tables.sql';

/** The `app` tables one migration file names after `prefix`. */
async function tablesNamed(file: string, prefix: RegExp): Promise<string[]> {
  const text = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
  const pattern = new RegExp(`^${prefix.source} app\\.(\\w+)\\b`, 'gm');
  return [...text.matchAll(pattern)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

/**
 * Migration 0123 retired the two 0.4 sandbox tables no 0.5 caller ever
 * wired: the FIFO admission-ticket lane and the workflow re-attach
 * checkpoints. The names come from the migration itself, so they stay
 * written only where the tables were created and where they were dropped.
 * Each dropped name must be a table 0017 created, and none may be left in
 * the migrated schema. Registered after the session lane, whose reserve,
 * hibernate and destroy paths are the ones that once wrote them.
 */
export async function checkSandboxRetiredTablesDropped(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const [dropped, created] = await Promise.all([
    tablesNamed(DROPPED_BY, /DROP TABLE IF EXISTS/),
    tablesNamed(CREATED_BY, /CREATE TABLE/),
  ]);
  const foreign = dropped.filter((table) => !created.includes(table));
  const left = await sql<{ table: string }[]>`
    SELECT c.relname AS "table"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relname = ANY(${dropped})
    ORDER BY c.relname
  `;
  record(
    'migration 0123 drops the two retired 0017 sandbox tables',
    dropped.length === 2 && foreign.length === 0 && left.length === 0,
    `dropped=${dropped.join(',') || 'none'} (want 2) notFrom0017=${foreign.join(',') || 'none'} stillPresent=${left.map((row) => row.table).join(',') || 'none'}`,
  );
}
