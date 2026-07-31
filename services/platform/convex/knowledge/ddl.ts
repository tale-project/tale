'use node';

/**
 * Creating the corpus schema on an organization's own database — by applying
 * the SAME migrations the bundled database uses, never a copy of them.
 *
 * The corpus tables are declared exactly once, in
 * `services/db/migrations/knowledge-db/<schema>/*.sql`. The bundled
 * knowledge database gets them from dbmate at container start; an
 * organization's own database starts empty and gets them from here, reading the
 * very same files. There is deliberately no TypeScript that declares a corpus
 * table: the schema was once written out in three places, and the copies drifted
 * until a deploy failed on a column one of them had never heard of.
 *
 * Each migration file contains a `-- migrate:up` section and a `-- migrate:down`
 * section. Only the up section is applied, in filename order, and the statements
 * are written to be idempotent, so a bootstrap that is interrupted or repeated
 * converges rather than failing.
 *
 * Where the files are found, in order:
 *   1. `KNOWLEDGE_MIGRATIONS_DIR` — the same variable the database container
 *      uses, so an image that ships the migrations only has to point at them.
 *   2. `services/db/migrations/knowledge-db` found by walking up from this
 *      module — how it works in development and in tests.
 *
 * A deployment whose image ships neither gets an ACTIONABLE refusal telling the
 * operator to apply the migrations to their database themselves. That is the
 * right failure: silently running a hand-written approximation of the schema
 * would put an organization's documents into tables that do not match what
 * every other deployment has.
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

/** Cached per directory: the files do not change while the process runs. */
const cachedSql = new Map<string, readonly string[]>();

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
 * The up-migration statements for both corpora, in application order.
 *
 * Throws when the migrations are not available, naming what the operator has to
 * do instead.
 */
export function corpusSchemaSql(): readonly string[] {
  const dir = findMigrationsDir();
  if (dir === null) {
    throw new Error(
      'The knowledge corpus migrations are not available in this deployment, so a new database cannot be prepared automatically. Apply services/db/migrations/knowledge-db/ to the database yourself, or set KNOWLEDGE_MIGRATIONS_DIR to where they are.',
    );
  }
  const cached = cachedSql.get(dir);
  if (cached) return cached;

  const statements: string[] = [];
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
      statements.push(
        upSection(readFileSync(path.join(schemaDir, file), 'utf8')),
      );
    }
  }
  cachedSql.set(dir, statements);
  return statements;
}

/** True when both corpora's core tables already exist — the database was
 * prepared (by an earlier bootstrap, or by the operator applying the
 * migrations by hand, which is exactly the remedy the missing-migrations
 * error names). */
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

/**
 * Create the corpus schema on a database that does not have it yet.
 *
 * Idempotent, and applied as a whole per file so a partially applied file
 * cannot leave a table without its indexes. A database that already carries
 * the corpus tables is READY without the migration files — deployments that
 * do not ship them (the bundled action runtime) must not turn the
 * "apply the migrations yourself" remedy into a dead end.
 */
export async function applyCorpusSchema(sql: Sql): Promise<void> {
  if (await corpusSchemaPresent(sql)) {
    logger.info(
      'the knowledge corpus schema is already present; nothing to prepare',
    );
    return;
  }
  const statements = corpusSchemaSql();
  logger.info(
    'preparing the knowledge corpus schema on a database that has not been used before',
  );
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  logger.info('the knowledge corpus schema is ready');
}

/**
 * The `migrate:up` half of a dbmate migration.
 *
 * The down half must never run during a bootstrap — for these baselines it is
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
