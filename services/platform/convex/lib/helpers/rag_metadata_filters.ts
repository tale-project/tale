/**
 * Structured pre-retrieval filters for in-process RAG search (#1517).
 *
 * These shapes are the canonical source of truth, consumed directly by the
 * in-process RAG search action (`convex/rag/search.ts`).
 */

import { normalizeFolderPath } from './rag_folder_path';

type RagMetadataFilterScalar = string | number | boolean;

/**
 * Flat metadata filter map: a scalar value is an equality test, a list
 * is an IN-test (e.g. `{ department: 'legal', year: [2023, 2024] }`).
 */
type RagMetadataFilters = Record<
  string,
  RagMetadataFilterScalar | RagMetadataFilterScalar[]
>;

/** Wire shape of the `/search` `filters` object (snake_case). */
interface RagSearchFilters {
  folder_path?: string;
  metadata?: RagMetadataFilters;
}

/**
 * Build the `/search` `filters` payload from camelCase inputs.
 * Returns `undefined` when no effective filter remains after
 * normalization so callers can omit the field entirely.
 */
function buildRagSearchFilters(options: {
  folderPath?: string | null;
  metadata?: RagMetadataFilters;
}): RagSearchFilters | undefined {
  const folderPath = normalizeFolderPath(options.folderPath);
  const metadata =
    options.metadata && Object.keys(options.metadata).length > 0
      ? options.metadata
      : undefined;
  if (!folderPath && !metadata) return undefined;
  return {
    ...(folderPath ? { folder_path: folderPath } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export { buildRagSearchFilters };
export type { RagMetadataFilters, RagSearchFilters };
