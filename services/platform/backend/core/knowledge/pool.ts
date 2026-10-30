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
 *
 * ## Which database a failure came from
 *
 * A postgres.js error says nothing of the client that raised it, so the
 * platform's outage rule (`db/unavailable.ts`) would read a knowledge
 * database that stopped answering as the platform's own database restarting.
 * Every pool and session this module hands out is therefore tracked: what it
 * rejects a statement with is marked with the database it came from
 * (`markKnowledgeDatabaseError`), and the doors answer such an outage
 * `KNOWLEDGE_DATABASE_UNAVAILABLE`. Each pool watches its own outages too:
 * logged when one begins and ends, reported once when it outlasts a routine
 * restart ({@link setKnowledgeOutageReporter}).
 */

import postgres, { type Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger';
import { createOutageWatch, type OutageWatch } from '../../db/outage-watch';
import { reconnectBackoffSeconds } from '../../db/sql';
import { resolvePostgresConnection } from '../../db/ssl';
import {
  describeDatabaseError,
  type KnowledgeDatabase,
  knowledgeDatabaseUnavailable,
  markKnowledgeDatabaseError,
  ROUTINE_RESTART_MS,
} from '../../db/unavailable';
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

let openPool: PoolFactory = (rawUrl, options) => {
  // TLS is resolved in ONE place for every Postgres this process reaches —
  // the app database, this deployment's corpus, and the databases
  // organizations bring themselves, whose `sslmode` arrives through
  // `buildConnectionUrl`. See `backend/db/ssl.ts`.
  const { url, ssl } = resolvePostgresConnection(rawUrl);
  return postgres(url, {
    max: options?.session ? 1 : knowledgePoolMax(),
    ssl,
    idle_timeout: options?.session ? 30 : 120,
    connect_timeout: 30,
    // A default deployment runs the corpus in a PostgreSQL container of its
    // own (`knowledge-db`), which meets the same restarts as the application
    // database's (`db/sql.ts`).
    backoff: reconnectBackoffSeconds,
    ...(options?.session ? { onnotice: () => undefined } : {}),
    connection: {
      // Both corpora on the search path so unqualified references resolve; the
      // platform's own SQL still qualifies every table.
      search_path: `${PRIVATE_KNOWLEDGE_SCHEMA},${PUBLIC_WEB_SCHEMA},public`,
    },
  });
};

/** Install a pool factory (a test double, or a host with its own driver).
 * Passing `null` restores the real postgres.js factory. */
export function setPoolFactory(factory: PoolFactory | null): void {
  openPool = factory ?? defaultPoolFactory;
}

const defaultPoolFactory: PoolFactory = openPool;

/** A pool this module opened: the tracked client callers get, and the one
 * under it, which eviction retires and shutdown ends. */
interface OpenPool {
  readonly sql: Sql;
  readonly raw: Sql;
  readonly subject: PoolSubject;
}

/** Whose database a pool reaches, as its outage lines and report name it. */
interface PoolSubject {
  readonly database: KnowledgeDatabase;
  /** The organization that last resolved to it (organizations that point at
   * one database share its pool); absent for the deployment's. */
  orgSlug: string | undefined;
}

/** Live pools, keyed by connection string, in least-recently-used order. */
const pools = new Map<string, OpenPool>();

/**
 * Pools eviction took out of {@link pools}. They are never ended there: a
 * caller may still hold one mid-statement or mid-transaction, and `end()`
 * would fail its next statement with `CONNECTION_ENDED`, the platform's own
 * doing read as an outage, or cut a running one after its timeout. A
 * retired pool closes its connections once they idle (`idle_timeout`) and is
 * then collected; shutdown ends the ones still alive.
 */
const retired = new Set<WeakRef<Sql>>();

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
  // Marked, not watched: the pool for the same database watches its outages.
  return trackClient(openPool(url, { session: true }), {
    database: databaseOf(url),
    watch: null,
  });
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

/** Connections one process opens to a corpus database (`KNOWLEDGE_DB_POOL_MAX`,
 * default 10). Every indexing job takes one while it commits a slice, so a
 * worker allowed more concurrent jobs than this queues on the pool — the boot
 * log says so (`main.ts`). */
export function knowledgePoolMax(): number {
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
  if (url === defaultKnowledgeUrl()) return poolFor(url);
  const sql = poolFor(url, orgSlug);
  await bootstrapOnce(url, sql, orgSlug);
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

/** Get or open the pool for a connection string, keeping it most-recently-used.
 * `orgSlug` names the organization an own database belongs to. */
function poolFor(url: string, orgSlug?: string): Sql {
  const existing = pools.get(url);
  if (existing) {
    pools.delete(url);
    pools.set(url, existing);
    if (orgSlug !== undefined) existing.subject.orgSlug = orgSlug;
    return existing.sql;
  }
  evictIfFull(url);
  const raw = openPool(url);
  const subject: PoolSubject = { database: databaseOf(url), orgSlug };
  const sql = trackClient(raw, {
    database: subject.database,
    watch: watchOutages(subject),
  });
  pools.set(url, { sql, raw, subject });
  logger.info('opened a knowledge database connection pool');
  return sql;
}

/** Retire the least-recently-used pool when at capacity ({@link retired}).
 * The deployment default and the pool being opened are never the victim. */
function evictIfFull(incoming: string): void {
  if (pools.size < MAX_POOLS) return;
  const keep = defaultKnowledgeUrl();
  for (const [key, victim] of pools) {
    if (key === keep || key === incoming) continue;
    pools.delete(key);
    bootstraps.delete(key);
    for (const ref of retired) {
      if (ref.deref() === undefined) retired.delete(ref);
    }
    retired.add(new WeakRef(victim.raw));
    logger.info(
      'retired the least recently used knowledge pool (cap reached); its connections close once idle',
    );
    return;
  }
}

function databaseOf(url: string): KnowledgeDatabase {
  return url === defaultKnowledgeUrl() ? 'deployment' : 'organization';
}

// ------------------------------------------------------ failure tracking

/** What a tracked client marks its failures with, and the outage watch its
 * statements feed (`null` for a session). */
interface Tracking {
  readonly database: KnowledgeDatabase;
  readonly watch: OutageWatch | null;
}

/**
 * `raw`, with every statement it makes tracked: the tagged template,
 * `unsafe` and `file`, a transaction or savepoint and the client its
 * callback gets, a reserved connection and its statements. What makes no
 * statement (identifiers, fragments, `sql.json`, `end`) passes untouched,
 * and so do a cursor's iterator, `listen`/`notify` and large objects, which
 * no knowledge code uses.
 */
function trackClient<T extends object>(raw: T, tracking: Tracking): T {
  return new Proxy(raw, {
    apply(target, thisArg, args) {
      if (typeof target !== 'function') {
        throw new TypeError('a knowledge client that is not callable');
      }
      return trackStatement(Reflect.apply(target, thisArg, args), tracking);
    },
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      switch (property) {
        case 'unsafe':
        case 'file':
          return (...args: unknown[]) =>
            trackStatement(Reflect.apply(value, target, args), tracking);
        case 'begin':
        case 'savepoint':
          return (...args: unknown[]) => {
            const thrown = handOver(args, tracking);
            return Promise.resolve(Reflect.apply(value, target, args)).catch(
              (error: unknown) => {
                if (!isObject(error) || !thrown.has(error)) {
                  noteFailure(error, tracking);
                }
                throw error;
              },
            );
          };
        case 'reserve':
          return (...args: unknown[]) =>
            Promise.resolve(Reflect.apply(value, target, args)).then(
              (reserved: unknown) =>
                isObject(reserved) ? trackClient(reserved, tracking) : reserved,
              (error: unknown) => {
                noteFailure(error, tracking);
                throw error;
              },
            );
        default:
          return value;
      }
    },
  });
}

/**
 * A statement postgres.js made, settling through the tracking: a `Query` is
 * a promise whose every settlement goes through its own `resolve` and
 * `reject` (`connection.js`). Anything else (an identifier, a fragment
 * builder, a test double's promise) is returned unchanged.
 */
function trackStatement<T>(made: T, tracking: Tracking): T {
  if (!isObject(made)) return made;
  const resolve: unknown = Reflect.get(made, 'resolve');
  const reject: unknown = Reflect.get(made, 'reject');
  if (typeof resolve !== 'function' || typeof reject !== 'function') {
    return made;
  }
  Reflect.set(made, 'resolve', (value: unknown) => {
    tracking.watch?.recovered();
    return Reflect.apply(resolve, made, [value]);
  });
  Reflect.set(made, 'reject', (error: unknown) => {
    noteFailure(error, tracking);
    return Reflect.apply(reject, made, [error]);
  });
  return made;
}

/**
 * Hand a transaction's callback (the last argument of `begin` and
 * `savepoint`) the tracked client, in place, and collect what it throws. A
 * transaction that fails with one of those is not marked again: a knowledge
 * statement's failure already is, and anything else the callback met, the
 * platform's own database or a defect, keeps its origin.
 */
function handOver(args: unknown[], tracking: Tracking): WeakSet<object> {
  const thrown = new WeakSet<object>();
  const remember = (error: unknown): void => {
    if (isObject(error)) thrown.add(error);
  };
  const last = args.length - 1;
  const callback = args[last];
  if (typeof callback !== 'function') return thrown;
  args[last] = (scope: unknown): unknown => {
    let made: unknown;
    try {
      made = Reflect.apply(callback, undefined, [
        isObject(scope) ? trackClient(scope, tracking) : scope,
      ]);
    } catch (error) {
      remember(error);
      throw error;
    }
    // postgres.js awaits an array of statements as one; keep it an array.
    if (Array.isArray(made) || !isThenable(made)) return made;
    return Promise.resolve(made).catch((error: unknown) => {
      remember(error);
      throw error;
    });
  };
  return thrown;
}

/** Mark what a tracked statement failed with, once (the statements queued
 * on one connection fail with the same error), and feed an outage to the
 * watch. */
function noteFailure(error: unknown, tracking: Tracking): void {
  if (!markKnowledgeDatabaseError(error, tracking.database)) return;
  if (tracking.watch !== null && knowledgeDatabaseUnavailable(error) !== null) {
    tracking.watch.failed(error);
  }
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof Reflect.get(value, 'then') === 'function';
}

// ------------------------------------------------------------ outages

/** A knowledge database outage, as {@link KnowledgeOutageReporter} gets it:
 * nothing of the connection, which names its host, user and database. */
export interface KnowledgeOutage {
  readonly database: KnowledgeDatabase;
  /** The organization whose own database it is; absent for the deployment's. */
  readonly orgSlug?: string;
  /** The driver's code (`ECONNREFUSED`, `57P01`, …), when it has one. */
  readonly code?: string;
  readonly outageMs: number;
}

/** Reports an outage that outlasted a routine restart: once per pool and
 * outage. */
export type KnowledgeOutageReporter = (outage: KnowledgeOutage) => void;

let outageReporter: KnowledgeOutageReporter | null = null;

/** Install what reports a knowledge database outage (`null` removes it). The
 * boot sequence installs it (`main.ts`), so this module needs nothing of the
 * reporting it feeds. */
export function setKnowledgeOutageReporter(
  reporter: KnowledgeOutageReporter | null,
): void {
  outageReporter = reporter;
}

/** A failure this long after the last one begins a new outage: a pool's
 * statements can be sparse, and an end no statement saw must not date the
 * next outage from this one. */
const OUTAGE_FORGET_MS = 15 * 60_000;

/** A pool's outage watch: the first failure warns, the first once the outage
 * outlasts a routine restart warns and is reported, the first success logs
 * its end. */
function watchOutages(subject: PoolSubject): OutageWatch {
  return createOutageWatch(
    ROUTINE_RESTART_MS,
    {
      began(error) {
        logger.warn(
          `${databaseName(subject)} is not answering: ${describeDatabaseError(error)}`,
        );
      },
      lasted(error, outageMs) {
        logger.warn(
          `${databaseName(subject)} is still not answering after ${Math.round(outageMs / 1000)}s`,
        );
        reportOutage({
          database: subject.database,
          orgSlug: subject.orgSlug,
          code: outageCode(error),
          outageMs,
        });
      },
      ended(outageMs) {
        logger.info(
          `${databaseName(subject)} is answering again after ${Math.round(outageMs / 1000)}s`,
        );
      },
    },
    { forgetAfterMs: OUTAGE_FORGET_MS },
  );
}

function databaseName(subject: PoolSubject): string {
  return subject.database === 'deployment'
    ? 'the deployment’s knowledge database'
    : `the knowledge database of organization "${subject.orgSlug ?? 'unknown'}"`;
}

function reportOutage(outage: KnowledgeOutage): void {
  if (outageReporter === null) return;
  try {
    outageReporter(outage);
  } catch (err) {
    logger.warn(
      `could not report a knowledge database outage: ${describe(err)}`,
    );
  }
}

/** The one detail of the error an outage report carries: its message names
 * the host. */
function outageCode(error: unknown): string | undefined {
  if (!isObject(error)) return undefined;
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)
    ? code
    : undefined;
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

/** Keyed by the pool object so the entry goes with the pool. */
const bm25Capability = new WeakMap<Sql, Promise<boolean>>();

/**
 * Whether this database's pgvector knows iterative index scans
 * (`hnsw.iterative_scan`, pgvector 0.8+) — the knob that keeps an approximate
 * vector scan producing candidates until the scope's filters have admitted
 * enough, instead of stopping at `ef_search` rows most of which another
 * organization's filter then rejects (2026-09-14 evaluation, h4). Probed
 * once per pool; a failed probe answers `false` (the dense leg then runs the
 * plain statement, today's behaviour) and is not cached, so a transient
 * error is retried on the next search.
 */
export function hnswIterativeScanAvailable(sql: Sql): Promise<boolean> {
  const cached = hnswCapability.get(sql);
  if (cached) return cached;
  const probe = (async (): Promise<boolean> => {
    try {
      await sql`SHOW hnsw.iterative_scan`;
      return true;
    } catch (err) {
      if (isUnrecognizedParameter(err)) {
        logger.info(
          'this knowledge database has a pgvector without iterative index scans — large scopes search with the plain approximate scan',
        );
        return false;
      }
      hnswCapability.delete(sql);
      logger.warn(
        `could not probe for hnsw.iterative_scan, searching with the plain scan this time: ${describe(err)}`,
      );
      return false;
    }
  })();
  hnswCapability.set(sql, probe);
  return probe;
}

const hnswCapability = new WeakMap<Sql, Promise<boolean>>();

/** SQLSTATE 42704 — `unrecognized configuration parameter`. */
function isUnrecognizedParameter(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    Reflect.get(err, 'code') === '42704'
  );
}

/** Close every open pool, retired ones included, and forget every cached
 * resolution. */
export async function closeKnowledgePools(): Promise<void> {
  const open = [...pools.values()].map((pool) => pool.raw);
  for (const ref of retired) {
    const pool = ref.deref();
    if (pool !== undefined) open.push(pool);
  }
  pools.clear();
  retired.clear();
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
