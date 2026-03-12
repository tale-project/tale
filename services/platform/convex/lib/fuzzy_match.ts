/**
 * Fuzzy matching utilities for folder path and file name resolution.
 *
 * ## Design Decision: Query-time matching, no persistent cache
 *
 * This module is used at query time to fuzzy-match folder paths and file names
 * directly against DB records loaded into memory. We intentionally chose NOT to
 * build a persistent file_tree cache table because:
 *
 * 1. Folders are few (typically <1K per org, MAX_FOLDER_DEPTH=20). Loading them
 *    all at query time costs <200KB — far below Convex's 16MB read limit and
 *    negligible compared to the existing MAX_SCAN=10K document scan.
 *
 * 2. A persistent cache would require sync hooks in 9+ document write paths and
 *    4 folder write paths. Missing any one causes silent data inconsistency.
 *
 * 3. Query-time matching has zero side effects: no new tables, no migrations,
 *    no mutation hooks, no sync issues.
 *
 * Do not refactor this into a persistent cache without re-evaluating these
 * trade-offs.
 */

const TOKEN_SEPARATORS = /[_\-\s.]+/;

/**
 * Standard Levenshtein distance using single-row DP.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function levenshteinThreshold(len: number): number {
  return Math.max(2, Math.floor(len * 0.3));
}

export interface FolderCandidate {
  name: string;
  id: string;
}

export type FuzzyFolderResult =
  | { match: FolderCandidate }
  | { suggestions: string[] }
  | null;

/**
 * Fuzzy-match a path segment against folder candidates at one tree level.
 *
 * Priority:
 * 1. Case-insensitive exact match → unique hit returned directly
 * 2. Prefix match (candidate name starts with target, case-insensitive)
 * 3. Levenshtein distance within threshold
 *
 * Returns:
 * - `{ match }` if exactly one candidate matched
 * - `{ suggestions }` if multiple candidates matched
 * - `null` if no candidates matched
 */
export function fuzzyMatchFolder(
  target: string,
  candidates: FolderCandidate[],
): FuzzyFolderResult {
  if (candidates.length === 0) return null;

  const targetLower = target.toLowerCase();

  // 1. Case-insensitive exact match
  const exactMatches = candidates.filter(
    (c) => c.name.toLowerCase() === targetLower,
  );
  if (exactMatches.length === 1) return { match: exactMatches[0] };
  if (exactMatches.length > 1)
    return { suggestions: exactMatches.map((c) => c.name) };

  // 2. Prefix match (candidate starts with target)
  const prefixMatches = candidates.filter((c) =>
    c.name.toLowerCase().startsWith(targetLower),
  );
  if (prefixMatches.length === 1) return { match: prefixMatches[0] };

  // 3. Levenshtein match
  const threshold = levenshteinThreshold(target.length);
  const levenshteinMatches: Array<{
    candidate: FolderCandidate;
    dist: number;
  }> = [];

  for (const c of candidates) {
    const dist = levenshteinDistance(targetLower, c.name.toLowerCase());
    if (dist <= threshold) {
      levenshteinMatches.push({ candidate: c, dist });
    }
  }

  // Combine prefix + levenshtein matches (deduplicated)
  const allMatchIds = new Set<string>();
  const allMatches: FolderCandidate[] = [];

  for (const c of prefixMatches) {
    if (!allMatchIds.has(c.id)) {
      allMatchIds.add(c.id);
      allMatches.push(c);
    }
  }
  for (const { candidate: c } of levenshteinMatches) {
    if (!allMatchIds.has(c.id)) {
      allMatchIds.add(c.id);
      allMatches.push(c);
    }
  }

  if (allMatches.length === 1) return { match: allMatches[0] };
  if (allMatches.length > 1)
    return { suggestions: allMatches.map((c) => c.name) };

  return null;
}

/**
 * Check if a search query fuzzy-matches a document title.
 *
 * Matching strategies (any match returns true):
 * 1. Case-insensitive substring (preserves existing behavior)
 * 2. Token-based fuzzy: split both query and title by separators (_-. space),
 *    then check if every query token fuzzy-matches at least one title token.
 */
export function fuzzyMatchTitle(searchQuery: string, title: string): boolean {
  const queryLower = searchQuery.toLowerCase();
  const titleLower = title.toLowerCase();

  // 1. Substring match (existing behavior)
  if (titleLower.includes(queryLower)) return true;

  // 2. Token-based fuzzy match
  const queryTokens = queryLower.split(TOKEN_SEPARATORS).filter(Boolean);
  const titleTokens = titleLower.split(TOKEN_SEPARATORS).filter(Boolean);

  if (queryTokens.length === 0) return false;

  return queryTokens.every((qt) =>
    titleTokens.some((tt) => {
      // Exact token match
      if (tt === qt) return true;
      // Token prefix match
      if (tt.startsWith(qt) || qt.startsWith(tt)) return true;
      // Levenshtein on tokens
      const threshold = levenshteinThreshold(qt.length);
      return levenshteinDistance(qt, tt) <= threshold;
    }),
  );
}
