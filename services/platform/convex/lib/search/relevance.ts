import type { Doc, TableNames } from '../../_generated/dataModel';
import type { SearchStrategy } from './types';

/** A row is "active" unless an explicit `lifecycleStatus` says otherwise.
 *  Rows missing the field (legacy / other tables) are treated as active.
 *  Reads loosely so any `Doc<T>` can be passed without per-table narrowing. */
export function isActiveRow(row: Record<string, unknown>): boolean {
  const status = row.lifecycleStatus;
  return (typeof status === 'string' ? status : 'active') === 'active';
}

/** Lowercased text for a searchable primitive field value. Strings and numbers
 *  are searchable; booleans, objects and arrays are not — ignoring them avoids
 *  both `[object Object]` matches and a boolean field accidentally matching the
 *  term "true"/"false". */
function fieldText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number') return value.toString().toLowerCase();
  return undefined;
}

/** Split a lowercased query into whitespace-delimited tokens. Multi-token
 *  queries match with AND semantics — every token must hit some field — so
 *  "john acme" finds "John" at "Acme Corp" rather than a literal "john acme". */
function tokenize(lowerTerm: string): string[] {
  return lowerTerm.split(/\s+/).filter(Boolean);
}

/** True when any punctuation/whitespace-delimited word in `text` starts with
 *  `token`. This is the signal that ranks "ann" → "Anna Lee" (word start) above
 *  "Brianna" (mid-word substring). */
function wordStartsWith(text: string, token: string): boolean {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.length > 0 && word.startsWith(token));
}

/** Per-field strength of one token, strongest first: 4 exact field, 3 field-
 *  prefix, 2 word-prefix, 1 substring, 0 none. */
function fieldTier(text: string | undefined, token: string): number {
  if (!text) return 0;
  if (text === token) return 4;
  if (text.startsWith(token)) return 3;
  if (wordStartsWith(text, token)) return 2;
  if (text.includes(token)) return 1;
  return 0;
}

/** True when one token hits any configured field — a text/array substring, or
 *  an id field exactly (raw, case-sensitive) or by substring. */
function tokenHitsRow<T extends TableNames>(
  record: Record<string, unknown>,
  strategy: SearchStrategy<T>,
  token: string,
  rawTerm: string,
): boolean {
  for (const field of strategy.textFields) {
    if (fieldText(record[field])?.includes(token)) return true;
  }
  for (const field of strategy.arrayTextFields ?? []) {
    const arr = record[field];
    if (
      Array.isArray(arr) &&
      arr.some((el) => fieldText(el)?.includes(token))
    ) {
      return true;
    }
  }
  for (const field of strategy.idFields ?? []) {
    const value = record[field];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = value.toString();
    if (text === rawTerm || text.toLowerCase().includes(token)) return true;
  }
  return false;
}

/**
 * True when the row matches the query. Multi-token queries use AND semantics:
 * every whitespace-delimited token must hit some configured field, so a row is
 * reachable by any combination of its searchable fields ("john acme" → first
 * name + company) rather than only by a literal substring of the whole query.
 */
export function rowMatches<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
  rawTerm: string,
): boolean {
  const tokens = tokenize(lowerTerm);
  if (tokens.length === 0) return true;
  const record = row as Record<string, unknown>;
  return tokens.every((token) =>
    tokenHitsRow(record, strategy, token, rawTerm),
  );
}

/** A whole-query exact id match is the strongest possible signal — it dominates
 *  any combination of text-field matches. */
const EXACT_ID_SCORE = 10_000;

/**
 * Relevance score for a row. Sums each token's best signal across `textFields`,
 * where a stronger match tier (exact > field-prefix > word-prefix > substring)
 * dominates and, on a tie, an earlier (higher-priority) field wins — so a hit on
 * `name` outranks the same hit on `email`. An exact id match short-circuits to
 * the top. Pure and page-local.
 */
function rowScore<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
): number {
  const tokens = tokenize(lowerTerm);
  if (tokens.length === 0) return 0;
  const record = row as Record<string, unknown>;

  for (const field of strategy.idFields ?? []) {
    const value = record[field];
    if (
      (typeof value === 'string' || typeof value === 'number') &&
      value.toString().toLowerCase() === lowerTerm
    ) {
      return EXACT_ID_SCORE;
    }
  }

  const fieldCount = strategy.textFields.length;
  let total = 0;
  for (const token of tokens) {
    let bestForToken = 0;
    strategy.textFields.forEach((field, index) => {
      const tier = fieldTier(fieldText(record[field]), token);
      if (tier === 0) return;
      // Tier dominates; the field-priority weight (earlier field = higher) only
      // breaks ties between equal tiers.
      const weight = fieldCount - index;
      bestForToken = Math.max(bestForToken, tier * (fieldCount + 1) + weight);
    });
    total += bestForToken;
  }
  return total;
}

/**
 * Order matched rows by relevance — strongest match first, then newest. Pure,
 * **page-local** sort: the caller has already paginated over the stable index
 * order, so re-ordering within the page keeps opaque cursors valid across
 * `loadMore`.
 */
export function scoreAndSort<T extends TableNames>(
  rows: ReadonlyArray<Doc<T>>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
): Doc<T>[] {
  return [...rows].sort((a, b) => {
    const byScore =
      rowScore(b, strategy, lowerTerm) - rowScore(a, strategy, lowerTerm);
    if (byScore !== 0) return byScore;
    return b._creationTime - a._creationTime;
  });
}
