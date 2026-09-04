'use node';

/**
 * Connections to the knowledge corpus databases — and the ONE place an
 * organization's corpus is addressed.
 *
 * ## The tenant chokepoint
 *
 * {@link getKnowledgePoolForOrg} is the only sanctioned way to reach corpus
 * data. Everything an organization owns — both corpora, their embeddings, their
 * caches — is routed through it, so a bring-your-own database genuinely
 * isolates that organization instead of isolating only whichever code paths
 * remembered to check.
 *
 * {@link getKnowledgePool} returns the DEPLOYMENT-DEFAULT pool and must never
 * be used for tenant-owned data. It exists for deployment-wide maintenance
 * only. Reading an organization's rows through it would read the shared
 * database no matter which database that organization actually uses — which
 * means either the wrong answer, or another tenant's answer. A test in this
 * directory scans for calls to it and fails on new ones, because the failure it
 * prevents is silent and the review that would catch it is human.
 *
 * ## Why pools are keyed by connection string, not by organization
 *
 * A pool per organization would open `orgs × pool_size` connections against the
 * shared database and exhaust its `max_connections` long before the organization
 * count got interesting. Two organizations pointing at the same database
 * therefore SHARE one pool — which is safe precisely because sharing a pool is
 * not sharing data: every statement is scoped by organization, and an
 * organization with its own database resolves to a different string and so to a
 * different pool.
 *
 * ## Bring-your-own bootstrap
 *
 * An organization's own database starts empty, so the first time a new
 * connection string is seen the corpus schema is applied to it — once, from the
 * same dbmate migrations the bundled database uses. The default pool is never
 * bootstrapped here: its schema is applied at container start, and the
 * application role may not be allowed to create extensions.
 *
 * The same single flight runs the corpus health hook the boot sequence
 * installs ({@link setCorpusBootstrapHook}): the database's BM25 indexes are
 * verified — and a corrupted one rebuilt — before the organization's first
 * write can reach them. The deployment-default database gets the same check
 * from its own boot step, which is why it is not bootstrapped here.
 */

import postgres, { type Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger';
import { buildConnectionUrl, readOrgConnection } from './connection';
import { applyCorpusSchema } from './ddl';

export {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from '../../../lib/knowledge/types';

import {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from '../../../lib/knowledge/types';

export interface PoolOptions {
  /**
   * ONE connection for maintenance work whose PostgreSQL session state (an
   * advisory lock, a long REINDEX) must not leak into pooled queries — and
   * whose notices nobody needs to read.
   */
  readonly session?: boolean;
}

/**
 * How a pool is actually opened. Replaceable so tests can observe which
 * connection string every call resolves to without a database — the tenant
 * chokepoint is asserted at exactly this seam.
 */
export type PoolFactory = (url: string, options?: PoolOptions) => Sql;

let openPool: PoolFactory = (url, options) =>
  postgres(url, {
    max: options?.session ? 1 : poolMax(),
    idle_timeout: options?.session ? 30 : 120,
    connect_timeout: 30,
    ...(options?.session ? { onnotice: () => undefined } : {}),
    connection: {
      // Both corpora on the search path so unqualified references resolve; the
      // platform's own SQL still qualifies every table.
      search_path: `${PRIVATE_KNOWLEDGE_SCHEMA},${PUBLIC_WEB_SCHEMA},public`,
    },
  });

/** Install a pool factory (a test double, or a host with its own driver).
 * Passing `null` restores the real postgres.js factory. */
export function setPoolFactory(factory: PoolFactory | null): void {
  openPool = factory ?? defaultPoolFactory;
}

const defaultPoolFactory: PoolFactory = openPool;

/** Live pools, keyed by connection string, in least-recently-used order. */
const pools = new Map<string, Sql>();

/** In-flight schema bootstraps, keyed by connection string, so concurrent
 * first touches of a new database await one run. A failed bootstrap is dropped
 * so the next call retries rather than caching the failure forever. */
const bootstraps = new Map<string, Promise<void>>();

/** Runs inside a bring-your-own database's bootstrap, after its schema is
 * current — the boot sequence installs the corpus health check here. */
export type CorpusBootstrapHook = (event: {
  readonly url: string;
  readonly orgSlug: string;
}) => Promise<void>;

let corpusBootstrapHook: CorpusBootstrapHook | null = null;

/** Install the hook every later bring-your-own bootstrap runs (`null` removes
 * it). A hook failure is logged and never fails the bootstrap: the corpus is
 * usable with its schema in place, whatever the check could not do. */
export function setCorpusBootstrapHook(hook: CorpusBootstrapHook | null): void {
  corpusBootstrapHook = hook;
}

/**
 * ONE dedicated connection to a knowledge database, for maintenance work that
 * holds session state — an advisory lock, a REINDEX. Close it when done.
 */
export function openKnowledgeSession(url: string): Sql {
  return openPool(url, { session: true });
}

interface CachedUrl {
  readonly url: string;
  readonly expires: number;
}

/** Organization to connection string, briefly cached so a hot search does not
 * re-read config files on every call. A configuration change takes effect
 * within the window. */
const orgUrls = new Map<string, CachedUrl>();
const ORG_URL_TTL_MS = 15_000;

/** How many distinct pools may stay open. The default database uses one; each
 * organization with its own adds another. */
const MAX_POOLS = 64;

/** The deployment-default connection string. */
export function defaultKnowledgeUrl(): string {
  const explicit = process.env.KNOWLEDGE_DATABASE_URL;
  if (explicit) return explicit;
  const password = process.env.DB_PASSWORD ?? '';
  return `postgresql://tale:${password}@knowledge-db:5432/tale_knowledge`;
}

function poolMax(): number {
  const raw = process.env.KNOWLEDGE_DB_POOL_MAX;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * The pool for an organization's corpus — the single tenant-routing entry
 * point.
 *
 * Resolves the organization's own database when it has one and the deployment
 * default when it does not, and bootstraps the corpus schema the first time a
 * non-default database is seen.
 */
export async function getKnowledgePoolForOrg(orgSlug: string): Promise<Sql> {
  const url = await resolveOrgUrl(orgSlug);
  const sql = poolFor(url);
  if (url !== defaultKnowledgeUrl()) await bootstrapOnce(url, sql, orgSlug);
  return sql;
}

/**
 * The DEPLOYMENT-DEFAULT pool.
 *
 * Not for tenant data — see the module note. Deployment-wide maintenance only.
 */
export function getKnowledgePool(): Sql {
  return poolFor(defaultKnowledgeUrl());
}

/**
 * Resolve which database an organization's corpus lives in.
 *
 * Throws when the organization HAS a configuration that cannot be used; only an
 * absent configuration resolves to the deployment default.
 */
export async function resolveOrgUrl(orgSlug: string): Promise<string> {
  const now = Date.now();
  const cached = orgUrls.get(orgSlug);
  if (cached && cached.expires > now) return cached.url;

  const configured = await readOrgConnection(orgSlug);
  const url = configured
    ? buildConnectionUrl(configured)
    : defaultKnowledgeUrl();
  orgUrls.set(orgSlug, { url, expires: now + ORG_URL_TTL_MS });
  return url;
}

/** Forget an organization's resolved database — call after its configuration
 * changes so the change does not wait out the cache window. */
export function invalidateOrgUrl(orgSlug: string): void {
  orgUrls.delete(orgSlug);
}

/** Get or open the pool for a connection string, keeping it most-recently-used. */
function poolFor(url: string): Sql {
  const existing = pools.get(url);
  if (existing) {
    pools.delete(url);
    pools.set(url, existing);
    return existing;
  }
  evictIfFull(url);
  const sql = openPool(url);
  pools.set(url, sql);
  logger.info('opened a knowledge database connection pool');
  return sql;
}

/** Close the least-recently-used pool when at capacity. The deployment default
 * and the pool being opened are never the victim. */
function evictIfFull(incoming: string): void {
  if (pools.size < MAX_POOLS) return;
  const keep = defaultKnowledgeUrl();
  for (const key of pools.keys()) {
    if (key === keep || key === incoming) continue;
    const victim = pools.get(key);
    pools.delete(key);
    bootstraps.delete(key);
    if (victim) {
      void victim.end({ timeout: 5 }).catch((err: unknown) => {
        logger.warn(
          `could not close an evicted knowledge pool: ${describe(err)}`,
        );
      });
    }
    logger.info('evicted the least recently used knowledge pool (cap reached)');
    return;
  }
}

/** Apply the corpus schema to a newly seen database, at most once per string,
 * then run the corpus health hook in the same flight. */
function bootstrapOnce(url: string, sql: Sql, orgSlug: string): Promise<void> {
  const running = bootstraps.get(url);
  if (running) return running;
  const started = applyCorpusSchema(sql)
    .then(() => runCorpusBootstrapHook(url, orgSlug))
    .catch((err: unknown) => {
      bootstraps.delete(url);
      throw err;
    });
  bootstraps.set(url, started);
  return started;
}

async function runCorpusBootstrapHook(
  url: string,
  orgSlug: string,
): Promise<void> {
  if (corpusBootstrapHook === null) return;
  try {
    await corpusBootstrapHook({ url, orgSlug });
  } catch (err) {
    logger.warn(
      `the corpus health check for organization "${orgSlug}" failed: ${describe(err)}`,
    );
  }
}

/**
 * Whether the database behind a pool has the BM25 extension.
 *
 * Probed once per pool. A FAILED probe is not cached and answers `true`: a
 * transient connection error must never be mistaken for a missing extension and
 * silently downgrade a healthy ParadeDB to vector-only for the rest of the
 * process. A genuinely missing extension is still caught by the keyword leg's
 * own error handling, so the optimistic answer costs one failed query at most.
 */
export function bm25Available(sql: Sql): Promise<boolean> {
  const cached = bm25Capability.get(sql);
  if (cached) return cached;
  const probe = (async (): Promise<boolean> => {
    try {
      const rows =
        await sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_search'`;
      const available = rows.length > 0;
      if (!available) {
        logger.info(
          'this knowledge database has no pg_search extension — searches run vector-only',
        );
      }
      return available;
    } catch (err) {
      bm25Capability.delete(sql);
      logger.warn(
        `could not probe for pg_search, assuming it is present: ${describe(err)}`,
      );
      return true;
    }
  })();
  bm25Capability.set(sql, probe);
  return probe;
}

/** Remember that a database has no usable BM25 index, so later searches skip
 * the keyword leg instead of failing it again. */
export function markBm25Unavailable(sql: Sql): void {
  bm25Capability.set(sql, Promise.resolve(false));
}

/** Keyed by the pool object so the entry disappears when the pool is evicted. */
const bm25Capability = new WeakMap<Sql, Promise<boolean>>();

/** Close every open pool and forget every cached resolution. */
export async function closeKnowledgePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  bootstraps.clear();
  orgUrls.clear();
  await Promise.all(
    open.map((sql) =>
      sql.end({ timeout: 5 }).catch((err: unknown) => {
        logger.warn(`could not close a knowledge pool: ${describe(err)}`);
      }),
    ),
  );
  logger.info('closed every knowledge database connection pool');
}

// ------------------------------------------------- PostgreSQL error classes

/** 42P01 — the table does not exist (the corpus has not been created yet). */
export function isUndefinedTable(err: unknown): boolean {
  return sqlState(err) === '42P01';
}

/** 42703 — the column does not exist (an older corpus, mid-migration). */
export function isUndefinedColumn(err: unknown): boolean {
  return sqlState(err) === '42703';
}

/** 3F000 — the schema does not exist, e.g. `paradedb.match(...)` on a database
 * with no pg_search. */
export function isUndefinedSchema(err: unknown): boolean {
  return sqlState(err) === '3F000';
}

/** 42883 — the function or operator does not exist, e.g. `@@@` with pg_search
 * missing or half-installed. */
export function isUndefinedFunction(err: unknown): boolean {
  return sqlState(err) === '42883';
}

/** Class XX — internal error, data corrupted, index corrupted: what a pgrx
 * panic (`XX000`) or a torn index block (`XX001`/`XX002`) surfaces as. */
export function isInternalOrCorruptionError(err: unknown): boolean {
  const state = sqlState(err);
  return typeof state === 'string' && state.startsWith('XX');
}

/** 54000 — a program limit was exceeded, e.g. an HNSW index above pgvector's
 * dimension ceiling. */
export function isProgramLimitExceeded(err: unknown): boolean {
  return sqlState(err) === '54000';
}

/** XX000 — an internal error; how index corruption surfaces. */
export function isInternalError(err: unknown): boolean {
  return sqlState(err) === 'XX000';
}

/** XX001 — data corruption. */
export function isDataCorrupted(err: unknown): boolean {
  return sqlState(err) === 'XX001';
}

/** SQLSTATE classes where the failure is about REACHING the database, not
 * about the statement: 08 (connection exception) and 28 (invalid
 * authorization — a rotated or revoked credential). */
const CONNECTION_SQLSTATE_CLASSES = new Set(['08', '28']);

/** Single connection-class SQLSTATEs outside those classes: 3D000 (the
 * database does not exist) and 57P03 (the server is not accepting
 * connections). */
const CONNECTION_SQLSTATES = new Set(['3D000', '57P03']);

/** Errors thrown below the protocol: postgres.js's own connection lifecycle
 * codes plus the Node system errors that surface through it (DNS, refused,
 * reset, unreachable). */
const CONNECTION_ERRNO_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * Whether an error means the database itself could not be reached or used at
 * all — bad credentials, DNS, refused/reset connections, a missing database —
 * as opposed to a statement that failed against a healthy connection.
 *
 * The distinction matters to callers whose FALLBACK STORE is the same
 * database: recording a failure into an unreachable corpus loses the record,
 * so a connection-class failure has to be reported somewhere else (the crawl
 * engine records it on the Convex `websites` row).
 */
export function isConnectionFailure(err: unknown): boolean {
  const code = sqlState(err);
  if (code === '') return false;
  if (CONNECTION_ERRNO_CODES.has(code)) return true;
  if (code.length !== 5) return false;
  return (
    CONNECTION_SQLSTATES.has(code) ||
    CONNECTION_SQLSTATE_CLASSES.has(code.slice(0, 2))
  );
}

function sqlState(err: unknown): string {
  if (err instanceof Error && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return '';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
