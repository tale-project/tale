/**
 * Folder-path normalization for the RAG folder-scoped search filter.
 *
 * The platform's canonical folder path format is `parent/child` —
 * segments joined by `/` with no leading or trailing slash (see
 * `folders/queries.ts buildFolderPath`). The Python twin of this helper
 * lives at `services/rag/app/utils/folder_path.py` — keep both in sync.
 */

/** Mirrors MAX_FOLDER_PATH_LENGTH in services/rag/app/utils/folder_path.py. */
const MAX_FOLDER_PATH_LENGTH = 1024;

/**
 * Normalize a folder path to the canonical `parent/child` form: strip
 * surrounding whitespace and slashes. Returns `undefined` for empty,
 * all-separator, or over-long values so callers can treat the result
 * as "no folder filter".
 */
function normalizeFolderPath(
  value: string | undefined | null,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^[\s/]+/, '').replace(/[\s/]+$/, '');
  if (normalized.length === 0 || normalized.length > MAX_FOLDER_PATH_LENGTH) {
    return undefined;
  }
  return normalized;
}

export { MAX_FOLDER_PATH_LENGTH, normalizeFolderPath };
