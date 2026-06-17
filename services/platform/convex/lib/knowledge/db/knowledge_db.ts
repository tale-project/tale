'use node';

/**
 * PostgreSQL connection (postgres.js) for the external, replaceable knowledge
 * corpus database (`knowledge-db`, ParadeDB).
 *
 * This replaces the per-service `database.ts` clients that lived in
 * `services/rag` and `services/crawler`. The knowledge corpus (documents,
 * chunks, websites, web pages, embeddings) lives in `knowledge-db` — NOT in
 * Convex tables. Convex node actions open a postgres.js client here and run the
 * ported RAG/crawler SQL against it.
 *
 * Connection string resolution:
 *   1. `KNOWLEDGE_DATABASE_URL` (preferred, explicit)
 *   2. `RAG_DATABASE_URL` (legacy alias, kept for migration parity)
 *   3. `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge`
 *      (compose default — `knowledge-db` is the service hostname)
 *
 * postgres.js manages its own internal pool, so callers use the shared `sql`
 * instance directly and wrap operations in `withRetry` (db/retry) for
 * transient-fault resilience.
 *
 * The two logical corpora live in separate schemas of the same database:
 *   - `private_knowledge` — RAG documents + chunks + semantic cache
 *   - `public_web`        — crawler websites + urls + chunks
 *
 * NOTE (live-stack): `knowledge-db` must have the schema migrations applied at
 * startup (see `services/db/migrations/*.sql`, applied via dbmate). This module
 * does NOT create the schema; it only pins embedding dimensions + HNSW indexes
 * at runtime (the dimension target depends on the configured embedding model
 * and is therefore not a static migration).
 */

import postgres, { type Sql } from 'postgres';

import { logger } from '../logger';

export const PRIVATE_KNOWLEDGE_SCHEMA = 'private_knowledge';
export const PUBLIC_WEB_SCHEMA = 'public_web';

let sqlInstance: Sql | null = null;

/** Resolve the knowledge-db connection string from the environment. */
export function getKnowledgeDatabaseUrl(): string {
  const explicit =
    process.env.KNOWLEDGE_DATABASE_URL || process.env.RAG_DATABASE_URL;
  if (explicit) {
    return explicit;
  }
  const password = process.env.DB_PASSWORD ?? '';
  return `postgresql://tale:${password}@knowledge-db:5432/tale_knowledge`;
}

/** Pool max size from `KNOWLEDGE_DB_POOL_MAX` (default 10). */
function poolMax(): number {
  const raw = process.env.KNOWLEDGE_DB_POOL_MAX;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * Initialize the shared postgres.js client.
 *
 * `search_path` is set to both knowledge schemas + public so unqualified table
 * references resolve, while the ported SQL keeps fully-qualified
 * `schema.table` names for clarity.
 */
export function initKnowledgePool(): Sql {
  if (sqlInstance !== null) {
    return sqlInstance;
  }
  sqlInstance = postgres(getKnowledgeDatabaseUrl(), {
    max: poolMax(),
    idle_timeout: 120,
    connect_timeout: 30,
    connection: {
      search_path: `${PRIVATE_KNOWLEDGE_SCHEMA},${PUBLIC_WEB_SCHEMA},public`,
    },
  });
  logger.info('Created knowledge-db connection pool');
  return sqlInstance;
}

/** Get the shared `sql` instance, initializing it on first use. */
export function getKnowledgePool(): Sql {
  return sqlInstance ?? initKnowledgePool();
}

/** Close the postgres.js client. */
export async function closeKnowledgePool(): Promise<void> {
  if (sqlInstance !== null) {
    const toClose = sqlInstance;
    sqlInstance = null;
    try {
      await toClose.end({ timeout: 5 });
    } finally {
      logger.info('Closed knowledge-db connection pool');
    }
  }
}

/** postgres.js surfaces SQLSTATE on `error.code`. 42P01 = undefined_table. */
export function isUndefinedTable(err: unknown): boolean {
  return pgCode(err) === '42P01';
}

/** 42703 = undefined_column. */
export function isUndefinedColumn(err: unknown): boolean {
  return pgCode(err) === '42703';
}

/** 54000 = program_limit_exceeded. */
export function isProgramLimitExceeded(err: unknown): boolean {
  return pgCode(err) === '54000';
}

/** XX000 = internal_error (used for BM25/HNSW corruption signalling). */
export function isInternalError(err: unknown): boolean {
  return pgCode(err) === 'XX000';
}

/** XX001 = data_corrupted. */
export function isDataCorrupted(err: unknown): boolean {
  return pgCode(err) === 'XX001';
}

function pgCode(err: unknown): string {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return '';
}
