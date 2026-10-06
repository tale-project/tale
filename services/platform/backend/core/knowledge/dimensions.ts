'use node';

/**
 * Where a vector is stored: the table of its width.
 *
 * A chunk's text lives in `<schema>.chunks`; its vector lives beside it, in
 * `<schema>.chunk_vectors_<width>`. Every supported width
 * (`KNOWLEDGE_VECTOR_WIDTHS`) has its table in both corpus schemas, created
 * by the knowledge migrations — never here, and never at runtime. An
 * organization's vectors are written to, and searched in, the table of the
 * width its embedding model states.
 *
 * That is what keeps widths apart. Vectors of different widths cannot be
 * compared, and a corpus that mixed them would not crash: part of it would
 * be unreachable from part of the queries, with nothing looking wrong until
 * someone noticed that retrieval had stopped finding documents. One column
 * of one width used to prevent that by refusing every other width for the
 * whole database, which also refused an organization that changed its
 * model. A table per width prevents it without refusing anyone: organizations
 * with models of different widths share a database, and a change of width
 * is a change of table.
 *
 * Two refusals remain. A width with no table cannot be stored
 * ({@link UnsupportedVectorWidth}); the settings refuse to save one, so this
 * is met only by a file written before the widths were a list. And a vector
 * whose length is not the stated width is not written
 * ({@link EmbeddingDimensionMismatch}): a provider that ignores the
 * requested width would otherwise fail the insert halfway through a batch,
 * with a database error that names no model.
 */

import {
  isKnowledgeVectorWidth,
  KNOWLEDGE_VECTOR_WIDTHS,
} from '@tale/shared/schemas/knowledge';

import type {
  PRIVATE_KNOWLEDGE_SCHEMA,
  PUBLIC_WEB_SCHEMA,
} from '../../../lib/knowledge/types';

/** pgvector cannot build an HNSW index above this width, so the wider
 * tables have none and are scanned in sequence. Exported so the
 * shipped-catalog gate can refuse a curated embedding width that would leave
 * a corpus scanning sequentially. */
export const HNSW_DIMENSION_LIMIT = 2000;

type CorpusSchema = typeof PRIVATE_KNOWLEDGE_SCHEMA | typeof PUBLIC_WEB_SCHEMA;

/** Raised when the stated vector width has no table to store it in. */
export class UnsupportedVectorWidth extends Error {
  readonly width: number;

  constructor(width: number, context: string) {
    super(
      `${context} states a vector width of ${width}, which a knowledge database cannot store. The supported widths are ${KNOWLEDGE_VECTOR_WIDTHS.join(', ')}.`,
    );
    this.name = 'UnsupportedVectorWidth';
    this.width = width;
  }
}

/** Raised when a model answers a vector of another width than stated. */
export class EmbeddingDimensionMismatch extends Error {
  readonly expected: number;
  readonly received: number;

  constructor(expected: number, received: number, context: string) {
    super(
      `${context} produced ${received}-dimensional vectors, but the embedding settings state a vector width of ${expected}. A vector is stored with the vectors of its own width, so one that disagrees with the settings is not written.`,
    );
    this.name = 'EmbeddingDimensionMismatch';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Refuse a width no table stores. Called where an organization's embedding
 * model is resolved, so the refusal comes before an embedding is paid for.
 */
export function assertVectorWidthSupported(
  dimensions: number,
  /** Whose width this is, for the refusal message. */
  context: string,
): void {
  if (!isKnowledgeVectorWidth(dimensions)) {
    throw new UnsupportedVectorWidth(dimensions, context);
  }
}

/**
 * The qualified table holding a corpus's vectors of `dimensions`.
 *
 * The name is interpolated into SQL, so it is built from the listed widths
 * alone: any other number throws before a statement exists.
 */
export function chunkVectorsTable(
  schema: CorpusSchema,
  dimensions: number,
  context: string,
): string {
  assertVectorWidthSupported(dimensions, context);
  return `${schema}.chunk_vectors_${dimensions}`;
}

/**
 * Check a vector before it is written.
 *
 * Cheap, and the only check that runs on every chunk — the table's own type
 * check would catch it too, but by then the batch is half-written and the
 * error says nothing about which model produced it.
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
