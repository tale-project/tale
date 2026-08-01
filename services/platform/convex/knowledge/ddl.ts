'use node';

/**
 * Preparing the corpus schema on an organization's own database — by applying
 * the SAME migrations the bundled database uses, never a copy of them.
 *
 * The corpus tables are declared exactly once, in
 * `services/db/migrations/knowledge-db/<schema>/*.sql`. The bundled
 * knowledge database gets them from dbmate at container start; an
 * organization's own database gets them from here, reading the very same
 * files. There is deliberately no TypeScript that declares a corpus table: the
 * schema was once written out in three places, and the copies drifted until a
 * deploy failed on a column one of them had never heard of.
 *
 * Application is version-aware, with dbmate's own semantics and ledger: each
 * schema tracks its applied versions in `<schema>.schema_migrations`, and only
 * files whose version is not recorded are applied, in filename order, then
 * recorded. That is what lets a database that was bootstrapped on an earlier
 * release receive a migration added later — skipping everything whenever the
 * tables already existed (as this module once did) is how `context_header`
 * went missing on every pre-existing corpus and broke chunk writes.
 *
 * A database bootstrapped before this ledger existed has tables but no
 * recorded versions; every file then applies again, which is safe because the
 * migrations are written to be idempotent — a bootstrap that is interrupted or
 * repeated converges rather than failing. Only each file's `-- migrate:up`
 * section is ever applied.
 *
 * Where the files are found, in order:
 *   1. `KNOWLEDGE_MIGRATIONS_DIR` — the same variable the database container
 *      uses, so an image that ships the migrations only has to point at them.
 *   2. `services/db/migrations/knowledge-db` found by walking up from this
 *      module — how it works in development and in tests.
 *
 * A deployment whose image ships neither gets an ACTIONABLE refusal telling the
 * operator to apply the migrations to their database themselves — unless the
 * corpus tables already exist, in which case the database container (or the
 * operator) owns migration application and this module must not turn that
 * arrangement into a dead end.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';

import { logger } from '../../lib/knowledge/logger';
import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from '../../lib/knowledge/types';

/** The corpora whose migrations are applied, in the order they must run. */
const CORPUS_SCHEMAS = [PRIVATE_KNOWLEDGE_SCHEMA, PUBLIC_WEB_SCHEMA] as const;

const UP_MARKER = '-- migrate:up';
const DOWN_MARKER = '-- migrate:down';

const MISSING_MIGRATIONS_REMEDY =
  'The knowledge corpus migrations are not available in this deployment, so a new database cannot be prepared automatically. Apply services/db/migrations/knowledge-db/ to the database yourself, or set KNOWLEDGE_MIGRATIONS_DIR to where they are.';

/** One migration file: where it applies, its ledger identity, and its up SQL. */
export interface CorpusMigration {
  schema: (typeof CORPUS_SCHEMAS)[number];
  /** dbmate's version: the filename's digits before the first underscore. */
  version: string;
  /** The filename, for logs. */
  name: string;
  /** The `-- migrate:up` section, the only part that is ever applied. */
  sql: string;
}

/** Cached per directory: the files do not change while the process runs. */
const cachedMigrations = new Map<string, readonly CorpusMigration[]>();

/** Where the migrations live, or `null` when this deployment does not ship
 * them. */
export function findMigrationsDir(): string | null {
  const configured = process.env.KNOWLEDGE_MIGRATIONS_DIR;
  if (configured && existsSync(configured)) return configured;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(
      dir,
      'services',
      'db',
      'migrations',
      'knowledge-db',
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Every corpus migration, in application order: schema by schema, files in
 * filename order within each.
 *
 * Throws when the migrations are not available, naming what the operator has to
 * do instead.
 */
export function corpusMigrations(): readonly CorpusMigration[] {
  const dir = findMigrationsDir();
  if (dir === null) {
    throw new Error(MISSING_MIGRATIONS_REMEDY);
  }
  const cached = cachedMigrations.get(dir);
  if (cached) return cached;

  const migrations: CorpusMigration[] = [];
  for (const schema of CORPUS_SCHEMAS) {
    const schemaDir = path.join(dir, schema);
    if (!existsSync(schemaDir)) {
      throw new Error(
        `The knowledge corpus migrations at ${dir} are missing the "${schema}" directory.`,
      );
    }
    const files = readdirSync(schemaDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    if (files.length === 0) {
      throw new Error(
        `The knowledge corpus migrations at ${dir} contain no SQL for "${schema}".`,
      );
    }
    for (const file of files) {
      const version = file.split('_')[0] ?? '';
      if (!/^\d+$/.test(version)) {
        throw new Error(
          `The knowledge corpus migration "${schema}/${file}" has no numeric version prefix; dbmate and this bootstrap both key the applied-migrations ledger on it.`,
        );
      }
      migrations.push({
        schema,
        version,
        name: file,
        sql: upSection(readFileSync(path.join(schemaDir, file), 'utf8')),
      });
    }
  }
  cachedMigrations.set(dir, migrations);
  return migrations;
}

/** True when both corpora's core tables already exist — the database was
 * prepared by an earlier bootstrap, or by the operator applying the
 * migrations by hand, which is exactly the remedy the missing-migrations
 * error names. */
async function corpusSchemaPresent(sql: Sql): Promise<boolean> {
  const rows = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n
       FROM information_schema.tables
      WHERE (table_schema, table_name) IN (
        ('${PRIVATE_KNOWLEDGE_SCHEMA}', 'documents'),
        ('${PRIVATE_KNOWLEDGE_SCHEMA}', 'chunks'),
        ('${PUBLIC_WEB_SCHEMA}', 'chunks')
      )`,
  );
  return rows[0]?.n === '3';
}

/** The versions a schema has already applied, per its dbmate ledger — created
 * here when absent, in dbmate's own shape, so either applier can pick up where
 * the other left off. */
async function appliedVersions(
  sql: Sql,
  schema: (typeof CORPUS_SCHEMAS)[number],
): Promise<Set<string>> {
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (version VARCHAR PRIMARY KEY)`,
  );
  const rows = await sql.unsafe<{ version: string }[]>(
    `SELECT version FROM ${schema}.schema_migrations`,
  );
  return new Set(rows.map((row) => row.version));
}

/**
 * Bring a database's corpus schema up to date: apply every migration its
 * per-schema ledger has not recorded, then record it.
 *
 * Idempotent, and applied as a whole per file so a partially applied file
 * cannot leave a table without its indexes. A database that already carries
 * the corpus tables is READY without the migration files — deployments that
 * do not ship them (the bundled action runtime) must not turn the
 * "apply the migrations yourself" remedy into a dead end.
 */
export async function applyCorpusSchema(sql: Sql): Promise<void> {
  if (findMigrationsDir() === null) {
    if (await corpusSchemaPresent(sql)) {
      logger.info(
        'the knowledge corpus tables are present and this deployment ships no migration files; applying pending migrations stays the job of the database container',
      );
      return;
    }
    throw new Error(MISSING_MIGRATIONS_REMEDY);
  }

  const migrations = corpusMigrations();
  let appliedCount = 0;
  for (const schema of CORPUS_SCHEMAS) {
    const applied = await appliedVersions(sql, schema);
    for (const migration of migrations) {
      if (migration.schema !== schema) continue;
      if (applied.has(migration.version)) continue;
      logger.info(
        `applying knowledge corpus migration ${schema}/${migration.name}`,
      );
      await sql.unsafe(migration.sql);
      await sql.unsafe(
        `INSERT INTO ${schema}.schema_migrations (version) VALUES ($1)
         ON CONFLICT (version) DO NOTHING`,
        [migration.version],
      );
      appliedCount += 1;
    }
  }
  if (appliedCount > 0) {
    logger.info(
      `the knowledge corpus schema is ready (${appliedCount} migration${appliedCount === 1 ? '' : 's'} applied)`,
    );
  }
}

/**
 * The `migrate:up` half of a dbmate migration.
 *
 * The down half must never run during a bootstrap — for these files it is
 * intentionally empty, but applying whatever follows the marker would be a
 * loaded gun pointed at a corpus.
 */
export function upSection(source: string): string {
  const start = source.indexOf(UP_MARKER);
  if (start < 0) {
    throw new Error(
      'A knowledge corpus migration has no "-- migrate:up" marker; refusing to guess which half to apply.',
    );
  }
  const body = source.slice(start + UP_MARKER.length);
  const end = body.indexOf(DOWN_MARKER);
  return (end < 0 ? body : body.slice(0, end)).trim();
}
