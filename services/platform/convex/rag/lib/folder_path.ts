'use node';

/**
 * Folder path normalization for the folder-scoped search filter.
 *
 * The platform's canonical folder path format is `parent/child` — segments
 * joined by `/` with no leading or trailing slash. The TypeScript twin in the
 * platform lives at `services/platform/convex/lib/helpers/rag_folder_path.ts`.
 */

export const MAX_FOLDER_PATH_LENGTH = 1024;

// Mirror Python's `value.strip(" \t\r\n/")` exactly — only these characters,
// trimmed from both ends.
const STRIP_RE = /^[ \t\r\n/]+|[ \t\r\n/]+$/g;

/**
 * Normalize a folder path to the canonical `parent/child` form. Strips
 * surrounding whitespace and slashes. Returns `null` for non-string, empty,
 * or all-separator values so callers can treat the result as "no folder".
 */
export function normalizeFolderPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(STRIP_RE, '');
  return normalized.length > 0 ? normalized : null;
}
