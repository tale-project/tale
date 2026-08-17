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

/**
 * How a multi-token query is matched.
 *
 * `'all'` — every token must hit some field. Right when the caller TYPED the
 * term: a picker, a mention autocomplete, a search box. "john acme" finds
 * "John" at "Acme Corp" rather than a literal "john acme".
 *
 * `'any'` — the term is a QUESTION someone asked, not a name they typed. Most
 * of its words ("what", "do we have", "about") are absent from the data by
 * construction, so requiring all of them finds nothing: the real query
 * "recruitment ads Facebook ad account project tasks" cannot match a task
 * titled "Set up Facebook ad account" under `'all'`. `'any'` drops function
 * words, keeps rows that hit a remaining token at word-start or better, and
 * leaves {@link scoreAndSort} to put the row that hit the most tokens first.
 */
export type MatchMode = 'all' | 'any';

/**
 * Function words dropped in `'any'` mode, across the three locales the app
 * ships (en, de, fr) — a question is asked in the reader's language, so an
 * English-only list would leave German and French questions full of noise
 * tokens that match every row.
 *
 * Deliberately NO domain vocabulary: "open", "done", "review" and the like
 * carry real meaning on a task board and must stay searchable.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // en
  'a',
  'about',
  'all',
  'am',
  'an',
  'and',
  'any',
  'anything',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'give',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'know',
  'like',
  'list',
  'me',
  'my',
  'need',
  'of',
  'on',
  'one',
  'or',
  'our',
  'out',
  'over',
  'please',
  'show',
  'so',
  'some',
  'tell',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'up',
  'us',
  'want',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  // de
  'aber',
  'alle',
  'als',
  'am',
  'auf',
  'aus',
  'bei',
  'bin',
  'bitte',
  'das',
  'dass',
  'dem',
  'den',
  'denn',
  'der',
  'des',
  'die',
  'du',
  'ein',
  'eine',
  'einem',
  'einen',
  'einer',
  'eines',
  'er',
  'es',
  'für',
  'gibt',
  'hat',
  'haben',
  'ich',
  'ihr',
  'im',
  'in',
  'ist',
  'kein',
  'keine',
  'mein',
  'mir',
  'mit',
  'nicht',
  'oder',
  'sich',
  'sie',
  'sind',
  'über',
  'uns',
  'unser',
  'von',
  'war',
  'waren',
  'was',
  'welche',
  'welcher',
  'wer',
  'werden',
  'wie',
  'wir',
  'wird',
  'wo',
  'warum',
  'zu',
  'zum',
  'zur',
  // fr
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'cette',
  'comment',
  'dans',
  'de',
  'des',
  'du',
  'elle',
  'elles',
  'en',
  'est',
  'et',
  'il',
  'ils',
  'je',
  'la',
  'le',
  'les',
  'leur',
  'ma',
  'mon',
  'ne',
  'nos',
  'notre',
  'nous',
  'ont',
  'ou',
  'où',
  'pas',
  'pour',
  'pourquoi',
  'quel',
  'quelle',
  'qui',
  'quoi',
  'sa',
  'se',
  'sera',
  'ses',
  'son',
  'sont',
  'sur',
  'tu',
  'un',
  'une',
  'vos',
  'votre',
  'vous',
  'était',
]);

/** Split a lowercased query into whitespace-delimited tokens. */
function tokenize(lowerTerm: string): string[] {
  return lowerTerm.split(/\s+/).filter(Boolean);
}

/**
 * The tokens a mode actually searches on. `'all'` searches the query verbatim;
 * `'any'` strips function words and one-character fragments.
 *
 * `'any'` can legitimately come back EMPTY — a query that is nothing but
 * function words ("what do we have?") carries no searchable signal. Returning
 * `[]` rather than falling back to the raw tokens is what lets the caller say
 * "too general to search" instead of returning every row in the org.
 */
export function queryTokens(lowerTerm: string, mode: MatchMode): string[] {
  const tokens = tokenize(lowerTerm);
  if (mode === 'all') return tokens;
  return tokens.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * The weakest tier that counts as a hit in `'any'` mode: a word-start match.
 *
 * A bare mid-word substring is noise once tokens are OR-ed — "ad" would pull in
 * every row containing "overhead" — whereas under `'all'` every other token
 * still has to hit, so a weak tier there is a supporting signal, not the whole
 * case for the row.
 */
const MIN_ANY_TIER = 2;

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

/** An id field matched raw and whole — the strongest signal a single token can
 *  carry, on a par with an exact text-field match. */
const ID_EXACT_TIER = 4;
/** An id field containing the token. Rated at word-start strength so a
 *  deliberate identifier lookup still counts in `'any'` mode, where a bare
 *  substring would not. */
const ID_SUBSTRING_TIER = 2;

/**
 * The strength of one token's best hit anywhere on the row, on the same scale
 * {@link fieldTier} uses (0 = no hit). Matching and ranking both read this, so
 * a row can never be kept by one rule and ordered by another.
 */
function tokenTier<T extends TableNames>(
  record: Record<string, unknown>,
  strategy: SearchStrategy<T>,
  token: string,
  rawTerm: string,
): number {
  let best = 0;
  for (const field of strategy.textFields) {
    best = Math.max(best, fieldTier(fieldText(record[field]), token));
  }
  for (const field of strategy.arrayTextFields ?? []) {
    const arr = record[field];
    if (!Array.isArray(arr)) continue;
    for (const element of arr) {
      best = Math.max(best, fieldTier(fieldText(element), token));
    }
  }
  for (const field of strategy.idFields ?? []) {
    const value = record[field];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = value.toString();
    if (text === rawTerm) return ID_EXACT_TIER;
    if (text.toLowerCase().includes(token)) {
      best = Math.max(best, ID_SUBSTRING_TIER);
    }
  }
  return best;
}

/**
 * True when the row matches the query, under the caller's {@link MatchMode}.
 *
 * `'all'` (the default) requires every whitespace-delimited token to hit some
 * configured field, so a row is reachable by any combination of its searchable
 * fields ("john acme" → first name + company) rather than only by a literal
 * substring of the whole query.
 *
 * `'any'` requires one surviving token to hit at word-start or better. An
 * all-stopword query matches NOTHING rather than everything — the caller is
 * expected to report that as "too general", which is the honest answer.
 */
export function rowMatches<T extends TableNames>(
  row: Doc<T>,
  strategy: SearchStrategy<T>,
  lowerTerm: string,
  rawTerm: string,
  mode: MatchMode = 'all',
): boolean {
  const tokens = queryTokens(lowerTerm, mode);
  if (tokens.length === 0) return mode === 'all';
  const record = row as Record<string, unknown>;
  if (mode === 'any') {
    return tokens.some(
      (token) => tokenTier(record, strategy, token, rawTerm) >= MIN_ANY_TIER,
    );
  }
  return tokens.every(
    (token) => tokenTier(record, strategy, token, rawTerm) > 0,
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
  mode: MatchMode,
): number {
  const tokens = queryTokens(lowerTerm, mode);
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
  mode: MatchMode = 'all',
): Doc<T>[] {
  return [...rows].sort((a, b) => {
    const byScore =
      rowScore(b, strategy, lowerTerm, mode) -
      rowScore(a, strategy, lowerTerm, mode);
    if (byScore !== 0) return byScore;
    return b._creationTime - a._creationTime;
  });
}
