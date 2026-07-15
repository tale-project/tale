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

import {
  buildKnowledgeUrl,
  readOrgKnowledgeConnection,
} from '../../../knowledge/file_utils';
import { logger } from '../logger';
import { ensureKnowledgeSchema } from './ensure_knowledge_schema';

export const PRIVATE_KNOWLEDGE_SCHEMA = 'private_knowledge';
export const PUBLIC_WEB_SCHEMA = 'public_web';

/**
 * Cached postgres.js pools, keyed by CONNECTION STRING. Two orgs pointing at the
 * SAME URL SHARE one pool — never one-pool-per-org, which would exhaust the
 * target's `max_connections`. The deployment-default pool lives here too, keyed
 * by `getKnowledgeDatabaseUrl()`. postgres.js manages its own per-pool internal
 * connections (`idle_timeout` reaps idle ones).
 */
const pools = new Map<string, Sql>();

/**
 * Per-URL schema-bootstrap promises so concurrent first-touches of a new BYO
 * connection string await ONE `ensureKnowledgeSchema` run; a failed bootstrap is
 * dropped so the next call retries.
 */
const schemaBootstraps = new Map<string, Promise<void>>();

interface UrlCacheEntry {
  url: string;
  expires: number;
}

/**
 * Short-TTL org→URL cache so hot RAG calls don't re-read the per-org config file
 * every time. A config change (or its removal) takes effect within the TTL.
 */
const orgUrlCache = new Map<string, UrlCacheEntry>();
const ORG_URL_TTL_MS = 15_000;

/**
 * Cap on distinct cached pools. The deployment default shares one; per-org BYO
 * stores add a few. When exceeded, the least-recently-used NON-default pool is
 * evicted + closed (postgres.js `end` drains in-flight queries first).
 */
const MAX_POOLS = 64;

/** Resolve the deployment-default knowledge-db connection string from the env. */
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
 * Get (or create) the cached pool for a connection string.
 *
 * `search_path` is set to both knowledge schemas + public so unqualified table
 * references resolve, while the ported SQL keeps fully-qualified `schema.table`
 * names for clarity. Every pool — default and BYO — uses identical options; a
 * BYO URL's `?sslmode=` is parsed by postgres.js.
 */
function getOrCreatePool(url: string): Sql {
  const existing = pools.get(url);
  if (existing) {
    // LRU touch: re-insert so it moves to the end (newest).
    pools.delete(url);
    pools.set(url, existing);
    return existing;
  }
  evictIfNeeded(url);
  const sql = postgres(url, {
    max: poolMax(),
    idle_timeout: 120,
    connect_timeout: 30,
    connection: {
      search_path: `${PRIVATE_KNOWLEDGE_SCHEMA},${PUBLIC_WEB_SCHEMA},public`,
    },
  });
  pools.set(url, sql);
  logger.info('Created knowledge-db connection pool');
  return sql;
}

/** Evict + close the LRU non-default pool when the cache is at capacity. */
function evictIfNeeded(incomingUrl: string): void {
  if (pools.size < MAX_POOLS) {
    return;
  }
  const defaultUrl = getKnowledgeDatabaseUrl();
  for (const key of pools.keys()) {
    if (key === defaultUrl || key === incomingUrl) {
      continue;
    }
    const victim = pools.get(key);
    pools.delete(key);
    if (victim) {
      void victim.end({ timeout: 5 }).catch((err: unknown) => {
        logger.warn(
          `Failed to close evicted knowledge-db pool: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    logger.info('Evicted least-recently-used knowledge-db pool (cap reached)');
    return;
  }
}

/**
 * Get the DEPLOYMENT-DEFAULT `sql` instance (the shared knowledge database),
 * creating it on first use.
 *
 * AI-AGENT GUARDRAIL — do NOT use this for any tenant-owned data. Nothing in the
 * knowledge databases is shared across organizations: every per-org read/write
 * for BOTH corpora (`private_knowledge` RAG + `public_web` crawler), their
 * embeddings, and their caches MUST be routed through
 * `getKnowledgePoolForOrg(orgSlug)` so a bring-your-own database isolates the
 * org's data. After the per-org crawler refactor this has NO remaining
 * tenant-path callers; a new call from request/scan/index/search code is almost
 * certainly a tenant-isolation bug — resolve the org's pool instead.
 */
export function getKnowledgePool(): Sql {
  return getOrCreatePool(getKnowledgeDatabaseUrl());
}

/**
 * Resolve an org's knowledge-DB connection string: its own BYO Postgres URL when
 * `<org>/knowledge/connection.json` is configured, else the deployment default.
 * Cached with a short TTL (`ORG_URL_TTL_MS`). Throws (fail-closed) if a present
 * per-org config is invalid or its password can't be decrypted.
 */
export async function resolveKnowledgeUrlForOrg(
  orgSlug: string,
): Promise<string> {
  const now = Date.now();
  const cached = orgUrlCache.get(orgSlug);
  if (cached && cached.expires > now) {
    return cached.url;
  }
  const resolved = await readOrgKnowledgeConnection(orgSlug);
  const url = resolved
    ? buildKnowledgeUrl(resolved)
    : getKnowledgeDatabaseUrl();
  orgUrlCache.set(orgSlug, { url, expires: now + ORG_URL_TTL_MS });
  return url;
}

/**
 * Get the knowledge pool for an org — the SINGLE per-org routing entry point for
 * BOTH corpora (`private_knowledge` RAG + `public_web` crawler). Resolves the
 * org's URL (BYO or deployment default), returns/creates the cached pool for it,
 * and — for a newly-seen NON-default URL — bootstraps BOTH schemas once (a BYO
 * DB starts empty). The default pool is never schema-bootstrapped here: its
 * schema is applied at startup, and the app user may lack CREATE-EXTENSION
 * rights.
 *
 * All tenant-owned knowledge data MUST route through this, never
 * `getKnowledgePool()` — nothing in the knowledge databases is shared across
 * organizations.
 */
export async function getKnowledgePoolForOrg(orgSlug: string): Promise<Sql> {
  const url = await resolveKnowledgeUrlForOrg(orgSlug);
  const sql = getOrCreatePool(url);
  if (url !== getKnowledgeDatabaseUrl()) {
    await ensureSchemaOnce(url, sql);
  }
  return sql;
}

/** Run `ensureKnowledgeSchema` at most once per connection string. */
function ensureSchemaOnce(url: string, sql: Sql): Promise<void> {
  const existing = schemaBootstraps.get(url);
  if (existing) {
    return existing;
  }
  const p = ensureKnowledgeSchema(sql).catch((err: unknown) => {
    schemaBootstraps.delete(url);
    throw err;
  });
  schemaBootstraps.set(url, p);
  return p;
}

/** Drop the cached org→URL resolution for an org (call after a config change). */
export function invalidateOrgKnowledgeUrl(orgSlug: string): void {
  orgUrlCache.delete(orgSlug);
}

/** Close ALL cached postgres.js pools (default + every BYO). */
export async function closeKnowledgePool(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  schemaBootstraps.clear();
  orgUrlCache.clear();
  await Promise.all(
    all.map((sql) =>
      sql.end({ timeout: 5 }).catch((err: unknown) => {
        logger.warn(
          `Failed to close a knowledge-db pool: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }),
    ),
  );
  logger.info('Closed all knowledge-db connection pools');
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
