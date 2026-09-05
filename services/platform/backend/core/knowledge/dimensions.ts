'use node';

/**
 * Embedding dimensions, pinned per database.
 *
 * A corpus stores its vectors in ONE column of ONE declared width. That width
 * comes from the organization's configured embedding model, which a migration
 * cannot know, so the column is created unpinned and narrowed here the first
 * time the database is used.
 *
 * Once pinned, the width is a contract. A vector of a different width is
 * refused — by this module before a write is attempted, and by PostgreSQL
 * itself if anything ever got past it. That refusal is the point. Mixing widths
 * in one column is not a crash: it is a corpus where some vectors are
 * unreachable from some queries, where similarity scores mean different things
 * per row, and where nothing looks wrong until someone notices that retrieval
 * has quietly stopped finding half the documents. There is no repair short of
 * re-embedding everything, so the write is refused instead.
 *
 * The pin is per DATABASE, not per organization, because the column is per
 * database. Organizations sharing the bundled database must therefore agree on
 * a width; an organization that needs a different embedding model brings its
 * own database, where it pins its own.
 *
 * The HNSW index depends on the pinned width, so it is created here too — and
 * skipped, with a warning rather than an error, above pgvector's indexable
 * ceiling: a sequential scan is slow, but a corpus that refuses to accept
 * documents is unusable.
 */

import type { Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger';
import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types';
import { isProgramLimitExceeded, isUndefinedTable } from './pool';

/** pgvector cannot build an HNSW index above this width. */
const HNSW_DIMENSION_LIMIT = 2000;

/** What one database has been pinned to, keyed by connection string. The
 * width is a per-DATABASE policy — every schema in it stores the same
 * width — so this map is deliberately not schema-keyed. */
const pinned = new Map<string, number>();

/** Which schemas of a database have actually been ALTERed, keyed by
 * connection string. The width policy above is database-wide, but the ALTER
 * and index build happen per schema — `private_knowledge` being pinned must
 * not short-circuit the first `public_web` write. */
const appliedSchemas = new Map<string, Set<string>>();

/** In-flight pins, keyed by `dbUrl#schema`, so two concurrent first writes
 * do not race to ALTER the same column. */
const pinning = new Map<string, Promise<void>>();

/** Raised when a write would put a vector of the wrong width into a corpus. */
export class EmbeddingDimensionMismatch extends Error {
  readonly expected: number;
  readonly received: number;

  constructor(expected: number, received: number, context: string) {
    super(
      `${context} produced ${received}-dimensional vectors, but this knowledge database stores ${expected}-dimensional ones. Mixing widths in one corpus makes part of it unsearchable. Use the model the corpus was built with, or give this organization its own knowledge database.`,
    );
    this.name = 'EmbeddingDimensionMismatch';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Ensure a database stores vectors of exactly `dimensions`.
 *
 * The first caller for a given database pins the column and builds the index. A
 * later caller that wants a different width is refused — see the module note.
 */
export async function pinDimensions(args: {
  readonly sql: Sql;
  readonly dbUrl: string;
  readonly schema: string;
  readonly dimensions: number;
  /** Who is asking, for the refusal message. */
  readonly context: string;
}): Promise<void> {
  const already = pinned.get(args.dbUrl);
  if (already !== undefined && already !== args.dimensions) {
    throw new EmbeddingDimensionMismatch(
      already,
      args.dimensions,
      args.context,
    );
  }
  if (
    already !== undefined &&
    appliedSchemas.get(args.dbUrl)?.has(args.schema)
  ) {
    return;
  }

  const pinKey = `${args.dbUrl}#${args.schema}`;
  const running = pinning.get(pinKey);
  if (running) {
    await running;
    const settled = pinned.get(args.dbUrl);
    if (settled !== undefined && settled !== args.dimensions) {
      throw new EmbeddingDimensionMismatch(
        settled,
        args.dimensions,
        args.context,
      );
    }
    return;
  }

  const run = applyPin(args.sql, args.schema, args.dimensions)
    .then((outcome) => {
      if (outcome.kind === 'missing') {
        // Nothing was pinned: the corpus table is not there yet (a knowledge
        // database that migrates after the platform boots). Recording the
        // pin anyway would make every later write skip the ALTER and the
        // index build for the process lifetime — the column would stay an
        // untyped `vector`, accepting any width, once the table appeared.
        // Leave nothing recorded so the next write tries again.
        return;
      }
      if (outcome.kind === 'pinned_elsewhere') {
        // The database already holds vectors of another width — pinned by
        // another organization on the shared database, before this process
        // started. That width IS the contract: record it so every later
        // caller is answered from memory, and refuse this one the same way
        // a second organization is refused within one process.
        pinned.set(args.dbUrl, outcome.width);
        throw new EmbeddingDimensionMismatch(
          outcome.width,
          args.dimensions,
          args.context,
        );
      }
      pinned.set(args.dbUrl, args.dimensions);
      const schemas = appliedSchemas.get(args.dbUrl) ?? new Set<string>();
      schemas.add(args.schema);
      appliedSchemas.set(args.dbUrl, schemas);
      logger.info(
        `${args.schema} in this knowledge database now stores ${args.dimensions}-dimensional vectors (set by ${args.context})`,
      );
    })
    .finally(() => {
      pinning.delete(pinKey);
    });
  pinning.set(pinKey, run);
  await run;
}

/**
 * Check a vector before it is written.
 *
 * Cheap, and the only check that runs on every chunk — the database's own type
 * check would catch it too, but by then the batch is half-written and the error
 * says nothing about which model produced it.
 */
export function assertVectorWidth(
  vector: readonly number[],
  dimensions: number,
  context: string,
): void {
  if (vector.length !== dimensions) {
    throw new EmbeddingDimensionMismatch(dimensions, vector.length, context);
  }
}

/** Forget what a database was pinned to — for tests, and after a corpus is
 * dropped and rebuilt. */
export function forgetPinnedDimensions(dbUrl?: string): void {
  if (dbUrl === undefined) {
    pinned.clear();
    appliedSchemas.clear();
  } else {
    pinned.delete(dbUrl);
    appliedSchemas.delete(dbUrl);
  }
}

/** What a database is currently pinned to, or `undefined` if it has not been
 * touched this process. */
export function pinnedDimensions(dbUrl: string): number | undefined {
  return pinned.get(dbUrl);
}

type PinOutcome =
  /** The width now holds on `${schema}.chunks`. */
  | { readonly kind: 'applied' }
  /** That table does not exist yet — the caller must not record a pin
   * that never took effect. */
  | { readonly kind: 'missing' }
  /** The column is already declared at ANOTHER width — refused, never
   * re-typed; the caller records that width as the database's pin. */
  | { readonly kind: 'pinned_elsewhere'; readonly width: number };

/**
 * Narrow the vector columns and build the index.
 *
 * Only an untyped `vector` column is ever ALTERed. A column already declared
 * at a different width holds vectors another model produced: re-typing it
 * takes an ACCESS EXCLUSIVE lock on the shared chunks table and begins a
 * rewrite that pgvector then rejects (every tenant's search and indexing
 * blocked meanwhile, and the caller handed a raw database error instead of
 * the refusal) — or, on an EMPTY table, succeeds and silently re-pins the
 * whole shared corpus, so every other tenant's next write fails.
 */
async function applyPin(
  sql: Sql,
  schema: string,
  dimensions: number,
): Promise<PinOutcome> {
  const expected = `vector(${dimensions})`;
  let current: string | null;
  try {
    const rows = await sql.unsafe<{ format_type: string }[]>(
      `SELECT format_type(atttypid, atttypmod) AS format_type
       FROM pg_attribute
       WHERE attrelid = $1::regclass AND attname = 'embedding'`,
      [`${schema}.chunks`],
    );
    current = rows[0]?.format_type ?? null;
  } catch (err) {
    if (isUndefinedTable(err)) {
      logger.warn(
        `${schema}.chunks does not exist yet, so there is nothing to pin`,
      );
      return { kind: 'missing' };
    }
    throw err;
  }

  if (current !== expected) {
    if (current !== null && current !== 'vector') {
      const width = declaredVectorWidth(current);
      if (width === null) {
        throw new Error(
          `${schema}.chunks.embedding is declared as ${current}, which is not a vector width this deployment can pin; the configured model produces ${expected}`,
        );
      }
      logger.warn(
        `${schema}.chunks.embedding is ${current} but the configured model produces ${expected}; refusing rather than re-typing a corpus another model embedded`,
      );
      return { kind: 'pinned_elsewhere', width };
    }
    await sql.unsafe(
      `ALTER TABLE ${schema}.chunks ALTER COLUMN embedding TYPE ${expected}`,
    );
  }

  try {
    await sql.unsafe(`SELECT ${schema}.create_chunks_hnsw_index()`);
  } catch (err) {
    if (dimensions > HNSW_DIMENSION_LIMIT || isProgramLimitExceeded(err)) {
      logger.warn(
        `no HNSW index: ${dimensions} dimensions is above pgvector's indexable limit of ${HNSW_DIMENSION_LIMIT}, so vector search will scan sequentially`,
      );
    } else {
      throw err;
    }
  }

  // The semantic cache keys on query embeddings, so its column follows the same
  // width. Entries embedded at another width cannot be compared to new queries
  // and are discarded rather than left to return nonsense similarities.
  if (schema === PRIVATE_KNOWLEDGE_SCHEMA) {
    let cacheColumn: string | null = null;
    try {
      const rows = await sql.unsafe<{ format_type: string }[]>(
        `SELECT format_type(atttypid, atttypmod) AS format_type
         FROM pg_attribute
         WHERE attrelid = $1::regclass AND attname = 'query_embedding'`,
        [`${schema}.semantic_cache`],
      );
      cacheColumn = rows[0]?.format_type ?? null;
    } catch (err) {
      if (!isUndefinedTable(err)) throw err;
    }
    if (cacheColumn !== null && cacheColumn !== expected) {
      await sql.unsafe(`TRUNCATE TABLE ${schema}.semantic_cache`);
      await sql.unsafe(
        `ALTER TABLE ${schema}.semantic_cache ALTER COLUMN query_embedding TYPE ${expected}`,
      );
    }
  }
  return { kind: 'applied' };
}

/** The width a `vector(N)` declaration carries, or null for anything else. */
function declaredVectorWidth(formatType: string): number | null {
  const match = /^vector\((\d+)\)$/.exec(formatType);
  const width = match?.[1] !== undefined ? Number(match[1]) : Number.NaN;
  return Number.isInteger(width) && width > 0 ? width : null;
}
