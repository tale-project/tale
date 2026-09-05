'use node';

/**
 * Health of the corpus BM25 indexes — detection, a one-shot repair, and the
 * write guard that keeps a known-bad index from taking the database down.
 *
 * ## Why this exists
 *
 * A pg_search (ParadeDB) BM25 index lives in ordinary PostgreSQL blocks. A
 * crash-mode container stop can leave one of those blocks zeroed, and from
 * then on EVERY insert into the indexed table PANICs the server ("corrupted
 * page pointers: lower = 0, upper = 0, special = 0"): the database restarts,
 * the indexing job retries, and the loop repeats until an operator notices.
 * The heap is intact — the index is derived data — so `REINDEX` is a lossless
 * repair. This module makes the product perform that repair itself.
 *
 * ## Detection
 *
 * `pdb.verify_index(index)` returns one row per check (`passed`, `details`)
 * on a readable index and RAISES on one whose segments cannot be read. Both a
 * failed check and a raised corruption error (SQLSTATE class XX) mean
 * "unhealthy". A missing verifier (a pg_search too old to ship
 * `pdb.verify_index`) or any other failure to run it (permissions, a timeout,
 * a dropped connection) is "unverifiable", and an unverifiable index is never
 * rebuilt: rebuilding healthy indexes on every boot would be an outage of our
 * own making. Indexes are discovered by access
 * method (`pg_am.amname = 'bm25'`), never by name, so a corpus that grows a
 * third BM25 index is covered without anyone remembering this file. HNSW
 * (pgvector) indexes are deliberately out of scope: pgvector ships no verifier
 * and tolerates orphaned tail pages.
 *
 * ## Repair policy
 *
 * Small (at most the inline limit) → `REINDEX INDEX` right here, blocking the
 * caller, then verify again. Large → the caller schedules a background
 * `REINDEX INDEX CONCURRENTLY` ({@link rebuildBm25IndexInBackground}) and
 * writes to that corpus are refused with a coded error — never a PANIC —
 * until the rebuilt index verifies. Exactly ONE repair attempt per index per
 * process lifetime: a rebuild that does not restore health stops here, the
 * caller alerts, and nothing loops.
 *
 * ## Coordination
 *
 * A PostgreSQL advisory lock on the KNOWLEDGE database, held on a dedicated
 * single-connection session so the lock lives exactly as long as the session,
 * makes one process repair while concurrently booting siblings (api + worker,
 * scaled replicas) skip quietly. Their writes queue behind the REINDEX's table
 * lock and land on the rebuilt index.
 */

import type { Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger';
import {
  isInternalOrCorruptionError,
  isUndefinedFunction,
  isUndefinedSchema,
  openKnowledgeSession,
} from './pool';
import {
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
} from './rag_error_codes';

/** Advisory lock key, on the KNOWLEDGE database, serializing repairs across
 * processes. Distinct from the app database's migration lock. */
export const INDEX_REPAIR_LOCK_KEY = 72_085_010;

/** Largest index rebuilt synchronously by default: 1 GiB. */
export const DEFAULT_INLINE_REPAIR_MAX_BYTES = 1024 ** 3;

/** How long a refused corpus stays refused before the next write re-verifies
 * the index — the seam through which a rebuild completed by ANOTHER process
 * (a scaled worker, an operator's hand-run REINDEX) reopens writes here. */
export const WRITE_GUARD_RECHECK_MS = 5 * 60_000;

/** `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` — the inline/background split. */
export function inlineRepairMaxBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_INLINE_REPAIR_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(
      `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES=${raw} is not a non-negative integer — using the default (${DEFAULT_INLINE_REPAIR_MAX_BYTES})`,
    );
    return DEFAULT_INLINE_REPAIR_MAX_BYTES;
  }
  return parsed;
}

/** `KNOWLEDGE_INDEX_REPAIR_DISABLED=1|true` — the operator kill switch. */
export function repairDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.KNOWLEDGE_INDEX_REPAIR_DISABLED;
  return raw === '1' || raw === 'true';
}

// ------------------------------------------------------------------ indexes

/** One BM25 index as the catalog describes it. */
export interface Bm25Index {
  readonly schema: string;
  readonly name: string;
  /** `pg_relation_size` — what the repair policy is decided on. */
  readonly sizeBytes: number;
  /** `pg_index.indisvalid` — false for the copy an interrupted
   * `REINDEX CONCURRENTLY` leaves behind. */
  readonly valid: boolean;
}

/** `schema.name`, the spelling every log line and notification uses. */
export function indexName(index: Pick<Bm25Index, 'schema' | 'name'>): string {
  return `${index.schema}.${index.name}`;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quotedIndex(index: Pick<Bm25Index, 'schema' | 'name'>): string {
  return `${quoteIdent(index.schema)}.${quoteIdent(index.name)}`;
}

/** Every BM25 index in the database, by access method — never by name. */
async function discoverBm25Indexes(session: Sql): Promise<Bm25Index[]> {
  const rows = await session.unsafe<
    { schema: string; name: string; valid: boolean; bytes: string }[]
  >(
    `SELECT n.nspname AS schema, c.relname AS name, i.indisvalid AS valid,
            pg_relation_size(c.oid)::text AS bytes
       FROM pg_class c
       JOIN pg_am am ON am.oid = c.relam
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_index i ON i.indexrelid = c.oid
      WHERE am.amname = 'bm25'
      ORDER BY n.nspname, c.relname`,
  );
  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    valid: row.valid,
    sizeBytes: Number(row.bytes),
  }));
}

// ------------------------------------------------------------- verification

/** One `pdb.verify_index` row. */
export interface IndexCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly details: string;
}

export type VerifyResult =
  | { readonly status: 'healthy'; readonly checks: readonly IndexCheck[] }
  | {
      readonly status: 'unhealthy';
      readonly checks: readonly IndexCheck[];
      readonly reason: string;
    }
  | { readonly status: 'unverifiable'; readonly reason: string };

/**
 * Run the verifier over one index.
 *
 * Never throws: a raised error IS a verdict (the corrupted index raises
 * instead of reporting), and only a missing verifier is "unverifiable".
 */
async function verifyBm25Index(
  session: Sql,
  index: Pick<Bm25Index, 'schema' | 'name'>,
): Promise<VerifyResult> {
  try {
    const rows = await session.unsafe<
      { check_name: string; passed: boolean; details: string | null }[]
    >(
      `SELECT check_name, passed, details
         FROM pdb.verify_index(format('%I.%I', $1::text, $2::text)::regclass)`,
      [index.schema, index.name],
    );
    const checks = rows.map((row) => ({
      check: row.check_name,
      passed: row.passed,
      details: row.details ?? '',
    }));
    const failed = checks.filter((check) => !check.passed);
    if (failed.length === 0) return { status: 'healthy', checks };
    return {
      status: 'unhealthy',
      checks,
      reason: failed
        .map((check) => `${check.check}: ${check.details}`)
        .join('; '),
    };
  } catch (error) {
    if (isUndefinedFunction(error) || isUndefinedSchema(error)) {
      return { status: 'unverifiable', reason: describe(error) };
    }
    // pg_search reports a corrupted index by RAISING — a pgrx panic surfaces
    // as SQLSTATE XX000, a torn block as XX001/XX002 — so only that class is a
    // verdict. Anything else (a role that may not run the verifier, a
    // statement timeout, a dropped connection) says nothing about the index,
    // and rebuilding it — or refusing its writes — on that account would turn
    // an unrelated hiccup into an outage of our own making.
    if (isInternalOrCorruptionError(error)) {
      return {
        status: 'unhealthy',
        checks: [],
        reason: `pdb.verify_index raised: ${describe(error)}`,
      };
    }
    return {
      status: 'unverifiable',
      reason: `pdb.verify_index could not run: ${describe(error)}`,
    };
  }
}

// ------------------------------------------------------------------ repairs

export type RepairPath = 'inline' | 'background';

export type IndexOutcome =
  | { readonly kind: 'healthy'; readonly checks: readonly IndexCheck[] }
  | { readonly kind: 'unverifiable'; readonly reason: string }
  /** `indisvalid = false` — a leftover copy, skipped; the log names the remedy. */
  | { readonly kind: 'invalid' }
  /** The index named by a background job no longer exists. */
  | { readonly kind: 'missing' }
  /** Unhealthy and above the inline limit — the caller schedules the rebuild. */
  | { readonly kind: 'deferred'; readonly reason: string }
  | {
      readonly kind: 'repaired';
      readonly reason: string;
      readonly path: RepairPath;
      readonly reindexMs: number;
      readonly checks: readonly IndexCheck[];
    }
  | {
      readonly kind: 'repair_failed';
      readonly reason: string;
      readonly path: RepairPath;
      readonly reindexMs: number;
      readonly error: string;
    }
  /** Still unhealthy, and this process already rebuilt it once — no retry. */
  | { readonly kind: 'not_retried'; readonly reason: string };

export interface IndexReport {
  readonly index: Bm25Index;
  readonly outcome: IndexOutcome;
  readonly verifyMs: number;
}

export interface IndexHealthReport {
  readonly status: 'done' | 'locked' | 'disabled' | 'no_indexes' | 'error';
  /** When the run started — the notifications' idempotency stamp. */
  readonly startedAt: number;
  readonly indexes: readonly IndexReport[];
  readonly error?: string;
}

/** Which (database, index) pairs this process has already rebuilt. */
const attempted = new Set<string>();

function attemptKey(url: string, index: Pick<Bm25Index, 'schema' | 'name'>) {
  return `${url}#${indexName(index)}`;
}

/** Forget every recorded attempt — tests only. */
export function forgetRepairAttempts(): void {
  attempted.clear();
}

export interface HealOptions {
  /** The database — the key of the attempt registry and the write guard.
   * Carries the credential; it is never logged. */
  readonly url: string;
  /** How the database is named in logs. */
  readonly label: string;
  /** Opens ONE connection to `url`; closed by the caller. */
  readonly openSession?: (url: string) => Sql;
  /** Above this many bytes the rebuild is deferred to the caller. */
  readonly inlineMaxBytes?: number;
  readonly disabled?: boolean;
}

/**
 * Verify every BM25 index of a database and repair what can be repaired
 * inline. Never throws — the report carries the outcome, and the caller
 * decides what to schedule, refuse, and announce.
 */
export async function healBm25Indexes(
  options: HealOptions,
): Promise<IndexHealthReport> {
  const startedAt = Date.now();
  const { label } = options;
  if (options.disabled ?? repairDisabled()) {
    logger.warn(
      `${label}: BM25 index verification is disabled (KNOWLEDGE_INDEX_REPAIR_DISABLED) — a corrupted index will not be detected or repaired`,
    );
    return { status: 'disabled', startedAt, indexes: [] };
  }
  const inlineMaxBytes = options.inlineMaxBytes ?? inlineRepairMaxBytes();
  const session = (options.openSession ?? openKnowledgeSession)(options.url);
  try {
    if (!(await tryAdvisoryLock(session))) {
      logger.info(
        `${label}: another process is verifying the BM25 indexes — skipping`,
      );
      return { status: 'locked', startedAt, indexes: [] };
    }
    try {
      const indexes = await discoverBm25Indexes(session);
      if (indexes.length === 0) {
        logger.info(`${label}: no BM25 indexes to verify`);
        return { status: 'no_indexes', startedAt, indexes: [] };
      }
      const reports: IndexReport[] = [];
      for (const index of indexes) {
        reports.push(
          await examineIndex(session, index, {
            url: options.url,
            label,
            inlineMaxBytes,
          }),
        );
      }
      return { status: 'done', startedAt, indexes: reports };
    } finally {
      await releaseAdvisoryLock(session);
    }
  } catch (error) {
    logger.error(
      `${label}: BM25 index verification failed: ${describe(error)}`,
    );
    return { status: 'error', startedAt, indexes: [], error: describe(error) };
  } finally {
    await endSession(session);
  }
}

async function examineIndex(
  session: Sql,
  index: Bm25Index,
  ctx: { url: string; label: string; inlineMaxBytes: number },
): Promise<IndexReport> {
  const name = indexName(index);
  const size = humanBytes(index.sizeBytes);
  if (!index.valid) {
    logger.warn(
      `${ctx.label}: BM25 index ${name} is marked invalid — the copy an interrupted REINDEX CONCURRENTLY leaves behind; drop it (DROP INDEX CONCURRENTLY ${quotedIndex(index)}) so it stops being reported`,
      { index: name, sizeBytes: index.sizeBytes },
    );
    return { index, outcome: { kind: 'invalid' }, verifyMs: 0 };
  }
  const started = performance.now();
  const verify = await verifyBm25Index(session, index);
  const verifyMs = Math.round(performance.now() - started);
  if (verify.status === 'unverifiable') {
    logger.info(
      `${ctx.label}: BM25 index ${name} cannot be verified (${verify.reason}) — leaving it alone`,
    );
    return {
      index,
      outcome: { kind: 'unverifiable', reason: verify.reason },
      verifyMs,
    };
  }
  if (verify.status === 'healthy') {
    logger.info(
      `${ctx.label}: BM25 index ${name} is healthy (${verify.checks.length} checks, ${size}, ${verifyMs} ms)`,
    );
    return {
      index,
      outcome: { kind: 'healthy', checks: verify.checks },
      verifyMs,
    };
  }
  const fields = {
    index: name,
    sizeBytes: index.sizeBytes,
    verifyMs,
    checks: verify.checks,
    reason: verify.reason,
  };
  const key = attemptKey(ctx.url, index);
  if (attempted.has(key)) {
    logger.error(
      `${ctx.label}: BM25 index ${name} is STILL unhealthy after this process already rebuilt it once — not retrying; an operator has to repair it (REINDEX INDEX ${quotedIndex(index)}) or restore the database: ${verify.reason}`,
      fields,
    );
    return {
      index,
      outcome: { kind: 'not_retried', reason: verify.reason },
      verifyMs,
    };
  }
  if (index.sizeBytes > ctx.inlineMaxBytes) {
    logger.warn(
      `${ctx.label}: BM25 index ${name} is unhealthy and larger than the inline limit (${size} > ${humanBytes(ctx.inlineMaxBytes)}) — rebuilding it in the background; writes to ${index.schema} are refused until it verifies: ${verify.reason}`,
      { ...fields, path: 'background' },
    );
    return {
      index,
      outcome: { kind: 'deferred', reason: verify.reason },
      verifyMs,
    };
  }
  attempted.add(key);
  logger.warn(
    `${ctx.label}: BM25 index ${name} is unhealthy (${size}) — rebuilding it now: ${verify.reason}`,
    { ...fields, path: 'inline' },
  );
  return {
    index,
    outcome: await reindex(session, index, 'inline', ctx.label, verify.reason),
    verifyMs,
  };
}

/** `REINDEX` one index, then verify it again — the one place a rebuild
 * happens, whichever path led here. */
async function reindex(
  session: Sql,
  index: Bm25Index,
  path: RepairPath,
  label: string,
  reason: string,
): Promise<IndexOutcome> {
  const name = indexName(index);
  const statement =
    path === 'inline'
      ? `REINDEX INDEX ${quotedIndex(index)}`
      : `REINDEX INDEX CONCURRENTLY ${quotedIndex(index)}`;
  const started = performance.now();
  try {
    // Never inside a transaction block: REINDEX CONCURRENTLY refuses one,
    // and a plain REINDEX needs none.
    await session.unsafe(statement, [], { prepare: false });
  } catch (error) {
    const reindexMs = Math.round(performance.now() - started);
    if (path === 'background') await dropInvalidCopy(session, index, label);
    logger.error(
      `${label}: REINDEX of BM25 index ${name} failed after ${reindexMs} ms (${path}) — an operator has to repair it or restore the database: ${describe(error)}`,
      { index: name, sizeBytes: index.sizeBytes, path, reindexMs },
    );
    return {
      kind: 'repair_failed',
      reason,
      path,
      reindexMs,
      error: `REINDEX failed: ${describe(error)}`,
    };
  }
  const reindexMs = Math.round(performance.now() - started);
  const after = await verifyBm25Index(session, index);
  if (after.status === 'healthy') {
    logger.warn(
      `${label}: rebuilt BM25 index ${name} (${humanBytes(index.sizeBytes)}, ${path}, ${reindexMs} ms) — re-verified healthy (${after.checks.length} checks)`,
      {
        index: name,
        sizeBytes: index.sizeBytes,
        path,
        reindexMs,
        checks: after.checks,
      },
    );
    return { kind: 'repaired', reason, path, reindexMs, checks: after.checks };
  }
  const error =
    after.status === 'unhealthy'
      ? after.reason
      : `re-verification unavailable: ${after.reason}`;
  logger.error(
    `${label}: BM25 index ${name} is STILL unhealthy after REINDEX (${path}, ${reindexMs} ms) — not retrying; an operator has to repair it or restore the database: ${error}`,
    { index: name, sizeBytes: index.sizeBytes, path, reindexMs, error },
  );
  return { kind: 'repair_failed', reason, path, reindexMs, error };
}

/** A failed `REINDEX CONCURRENTLY` leaves an invalid `<name>_ccnew` copy that
 * would be discovered (and reported) on every later run — drop it. */
async function dropInvalidCopy(
  session: Sql,
  index: Bm25Index,
  label: string,
): Promise<void> {
  const copy = { schema: index.schema, name: `${index.name}_ccnew` };
  try {
    await session.unsafe(
      `DROP INDEX CONCURRENTLY IF EXISTS ${quotedIndex(copy)}`,
      [],
      { prepare: false },
    );
  } catch (error) {
    logger.warn(
      `${label}: could not drop the invalid copy ${indexName(copy)} left by the failed REINDEX CONCURRENTLY — drop it by hand: ${describe(error)}`,
    );
  }
}

export interface RebuildOptions {
  readonly url: string;
  readonly label: string;
  readonly index: Pick<Bm25Index, 'schema' | 'name'>;
  readonly openSession?: (url: string) => Sql;
}

/**
 * The background half of the repair policy: `REINDEX INDEX CONCURRENTLY` one
 * index that {@link healBm25Indexes} deferred, then verify it.
 *
 * WAITS for the advisory lock rather than skipping — a sibling's inline
 * repair may be under way, and this job is in no hurry. Verifies first, so an
 * index another process (or an operator) already repaired is reported healthy
 * without a second rebuild. Never throws.
 */
export async function rebuildBm25IndexInBackground(
  options: RebuildOptions,
): Promise<IndexReport> {
  const { label } = options;
  const name = indexName(options.index);
  const unknown: Bm25Index = { ...options.index, sizeBytes: 0, valid: true };
  const session = (options.openSession ?? openKnowledgeSession)(options.url);
  try {
    await session.unsafe(`SELECT pg_advisory_lock($1)`, [
      INDEX_REPAIR_LOCK_KEY,
    ]);
    try {
      const index = (await discoverBm25Indexes(session)).find(
        (candidate) =>
          candidate.schema === options.index.schema &&
          candidate.name === options.index.name,
      );
      if (!index) {
        logger.warn(
          `${label}: BM25 index ${name} no longer exists — nothing to rebuild`,
        );
        return { index: unknown, outcome: { kind: 'missing' }, verifyMs: 0 };
      }
      if (!index.valid) {
        logger.warn(
          `${label}: BM25 index ${name} is marked invalid — drop it (DROP INDEX CONCURRENTLY ${quotedIndex(index)}) and let the next scan rebuild the original`,
        );
        return { index, outcome: { kind: 'invalid' }, verifyMs: 0 };
      }
      const started = performance.now();
      const verify = await verifyBm25Index(session, index);
      const verifyMs = Math.round(performance.now() - started);
      if (verify.status === 'unverifiable') {
        return {
          index,
          outcome: { kind: 'unverifiable', reason: verify.reason },
          verifyMs,
        };
      }
      if (verify.status === 'healthy') {
        logger.info(
          `${label}: BM25 index ${name} verifies healthy — it was rebuilt elsewhere; nothing to do`,
        );
        return {
          index,
          outcome: { kind: 'healthy', checks: verify.checks },
          verifyMs,
        };
      }
      const key = attemptKey(options.url, index);
      if (attempted.has(key)) {
        logger.error(
          `${label}: BM25 index ${name} is STILL unhealthy after this process already rebuilt it once — not retrying: ${verify.reason}`,
          { index: name, sizeBytes: index.sizeBytes, reason: verify.reason },
        );
        return {
          index,
          outcome: { kind: 'not_retried', reason: verify.reason },
          verifyMs,
        };
      }
      attempted.add(key);
      logger.warn(
        `${label}: rebuilding BM25 index ${name} (${humanBytes(index.sizeBytes)}) concurrently: ${verify.reason}`,
        {
          index: name,
          sizeBytes: index.sizeBytes,
          path: 'background',
          checks: verify.checks,
        },
      );
      return {
        index,
        outcome: await reindex(
          session,
          index,
          'background',
          label,
          verify.reason,
        ),
        verifyMs,
      };
    } finally {
      await releaseAdvisoryLock(session);
    }
  } catch (error) {
    logger.error(
      `${label}: background rebuild of BM25 index ${name} failed: ${describe(error)}`,
    );
    return {
      index: unknown,
      outcome: {
        kind: 'repair_failed',
        reason: 'scheduled rebuild',
        path: 'background',
        reindexMs: 0,
        error: describe(error),
      },
      verifyMs: 0,
    };
  } finally {
    await endSession(session);
  }
}

// -------------------------------------------------------------- write guard

export type CorpusWriteRefusalState = 'rebuilding' | 'repair_failed';

export interface CorpusWriteRefusal {
  readonly state: CorpusWriteRefusalState;
  readonly index: Pick<Bm25Index, 'schema' | 'name'>;
  readonly since: number;
  /** When the next write re-verifies the index instead of refusing outright. */
  recheckAt: number;
}

/** Refused corpora: database → schema → why. */
const refusals = new Map<string, Map<string, CorpusWriteRefusal>>();

/** Refuse writes into one corpus of one database until further notice. */
export function refuseCorpusWrites(
  url: string,
  schema: string,
  refusal: Pick<CorpusWriteRefusal, 'state' | 'index'>,
  now: number = Date.now(),
): void {
  let bySchema = refusals.get(url);
  if (!bySchema) {
    bySchema = new Map();
    refusals.set(url, bySchema);
  }
  bySchema.set(schema, {
    state: refusal.state,
    index: refusal.index,
    since: now,
    recheckAt: now + WRITE_GUARD_RECHECK_MS,
  });
}

/** Writes into the corpus may flow again. */
export function allowCorpusWrites(url: string, schema: string): void {
  const bySchema = refusals.get(url);
  if (!bySchema) return;
  bySchema.delete(schema);
  if (bySchema.size === 0) refusals.delete(url);
}

/** Why writes into a corpus are refused right now, or `null`. */
export function corpusWriteRefusal(
  url: string,
  schema: string,
): CorpusWriteRefusal | null {
  return refusals.get(url)?.get(schema) ?? null;
}

/** Forget every refusal — tests only. */
export function forgetCorpusWriteRefusals(): void {
  refusals.clear();
}

/**
 * What the app does when the write guard lifts a refusal ITSELF — a write
 * re-verified the index healthy (rebuilt in another process, or repaired
 * by an operator's REINDEX) outside any rebuild job. The job's outcomes
 * re-queue the files they parked; without this seam the self-lift resumed
 * writes and left those files parked with a note that said they would
 * resume on their own.
 */
export type CorpusWritesResumedHook = (args: {
  url: string;
  schema: string;
}) => Promise<void>;

let corpusWritesResumedHook: CorpusWritesResumedHook | null = null;

/** Install (or clear, with `null`) the app-side reaction to a self-lift. */
export function setCorpusWritesResumedHook(
  hook: CorpusWritesResumedHook | null,
): void {
  corpusWritesResumedHook = hook;
}

/** Raised by {@link assertCorpusWritable}: the corpus's BM25 index is being
 * rebuilt, or its rebuild failed. `code` is the `rag_error_code` surfaces
 * branch on; the message says what happens next. */
export class KnowledgeIndexUnavailable extends Error {
  readonly code:
    | typeof RAG_ERROR_INDEX_REBUILDING
    | typeof RAG_ERROR_INDEX_REPAIR_FAILED;
  readonly index: string;
  readonly state: CorpusWriteRefusalState;

  constructor(refusal: Pick<CorpusWriteRefusal, 'state' | 'index'>) {
    super(indexUnavailableMessage(refusal.state, indexName(refusal.index)));
    this.name = 'KnowledgeIndexUnavailable';
    this.state = refusal.state;
    this.index = indexName(refusal.index);
    this.code =
      refusal.state === 'rebuilding'
        ? RAG_ERROR_INDEX_REBUILDING
        : RAG_ERROR_INDEX_REPAIR_FAILED;
  }
}

/** The refusal's prose — what a document's failed-indexing dialog shows. */
export function indexUnavailableMessage(
  state: CorpusWriteRefusalState,
  index: string,
): string {
  return state === 'rebuilding'
    ? `The knowledge search index ${index} was found corrupted and is being rebuilt. Indexing is paused until the rebuild completes and resumes automatically — no action is needed.`
    : `The knowledge search index ${index} is corrupted and its automatic rebuild did not succeed. Indexing is paused until an operator repairs the index (REINDEX INDEX ${index}) or restores the knowledge database; it resumes on its own once the index verifies healthy again.`;
}

/**
 * The write guard: throw {@link KnowledgeIndexUnavailable} while the corpus's
 * BM25 index is known to be bad, so a write is refused with a coded error
 * instead of PANICking the server.
 *
 * A refusal is not forever: once per {@link WRITE_GUARD_RECHECK_MS} a write
 * re-verifies the index and lifts the refusal when it passes — the rebuild
 * may have completed in another process, or an operator may have repaired
 * the index by hand.
 */
export async function assertCorpusWritable(
  url: string,
  schema: string,
  options: { openSession?: (url: string) => Sql; now?: () => number } = {},
): Promise<void> {
  const refusal = refusals.get(url)?.get(schema);
  if (!refusal) return;
  const now = (options.now ?? Date.now)();
  if (now < refusal.recheckAt) throw new KnowledgeIndexUnavailable(refusal);
  // Claim the re-check before running it so concurrent writers do not all
  // verify the same index at once.
  refusal.recheckAt = now + WRITE_GUARD_RECHECK_MS;
  const name = indexName(refusal.index);
  const session = (options.openSession ?? openKnowledgeSession)(url);
  try {
    const verify = await verifyBm25Index(session, refusal.index);
    if (verify.status === 'healthy') {
      allowCorpusWrites(url, schema);
      logger.warn(
        `BM25 index ${name} verifies healthy again — writes to ${schema} resume`,
        { index: name, checks: verify.checks },
      );
      // The files parked behind the refusal resume with the writes. Never
      // fails the write that found the index healthy.
      if (corpusWritesResumedHook !== null) {
        try {
          await corpusWritesResumedHook({ url, schema });
        } catch (error) {
          logger.warn(
            `could not re-queue the files parked behind ${name}: ${describe(error)}`,
          );
        }
      }
      return;
    }
    logger.warn(
      verify.status === 'unhealthy'
        ? `BM25 index ${name} is still unhealthy — writes to ${schema} stay refused: ${verify.reason}`
        : `BM25 index ${name} could not be re-verified — writes to ${schema} stay refused until the next check: ${verify.reason}`,
      { index: name, state: refusal.state },
    );
  } finally {
    await endSession(session);
  }
  throw new KnowledgeIndexUnavailable(refusal);
}

// ------------------------------------------------------------------ helpers

async function tryAdvisoryLock(session: Sql): Promise<boolean> {
  const rows = await session.unsafe<{ locked: boolean }[]>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [INDEX_REPAIR_LOCK_KEY],
  );
  return rows[0]?.locked ?? false;
}

async function releaseAdvisoryLock(session: Sql): Promise<void> {
  try {
    await session.unsafe(`SELECT pg_advisory_unlock($1)`, [
      INDEX_REPAIR_LOCK_KEY,
    ]);
  } catch (error) {
    // The lock dies with the session anyway.
    logger.warn(`advisory unlock failed (ignored): ${describe(error)}`);
  }
}

async function endSession(session: Sql): Promise<void> {
  try {
    await session.end({ timeout: 5 });
  } catch (error) {
    logger.warn(`could not close the maintenance session: ${describe(error)}`);
  }
}

/** `2932736` → `2.9 MB`; SI units, one decimal. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
