/**
 * Word matching for the chat entity legs, as Postgres regex patterns.
 *
 * A chat leg receives a natural-language question and passes it to its query
 * as one search term. Every leg then compares that whole string as a single
 * substring, so "do we have red running shoes" only matches text literally
 * containing the whole phrase. It matches nothing.
 *
 * These patterns are used as an OR ALONGSIDE the existing phrase match, never
 * in place of it: the phrase check still answers a typed name fragment, and
 * replacing it would change what the shared listings return.
 *
 * Two rules make a question usable, and both come from the 0.4 `'any'` mode
 * this reuses:
 *
 *   - Function words and one-character fragments are dropped, so a query that
 *     is nothing but function words ("what do we have?") yields no patterns
 *     and the caller adds no word clause at all.
 *   - A token must match at the START of a word (`\m`), not anywhere in it.
 *     Without that floor an OR over tokens is noise: "ad" would match every
 *     row containing "overhead".
 *
 * {@link queryTokens} is imported rather than re-listed. It owns the stopword
 * set for en/de/fr, and a second copy here would drift from the one the 0.4
 * entity search still uses.
 */

import { queryTokens } from '../core/lib/search/relevance.ts';

/**
 * Split on anything that is not a letter or a digit — the same definition of a
 * word the 0.4 matcher uses on the TEXT side (`wordStartsWith`). Doing it to
 * the query too is what makes the two agree: without it a trailing question
 * mark rides along on the last token, so "what do we have?" yields `have?`,
 * which is neither a stopword nor a thing any row starts with.
 */
function normalizeQuery(term: string): string {
  return term.replaceAll(/[^\p{L}\p{N}]+/gu, ' ');
}

/** Escape the characters Postgres reads as regex operators. Normalization
 *  leaves only letters and digits, so this is a boundary guard, not a
 *  transformation any current token needs. */
function escapeRegex(token: string): string {
  return token.replaceAll(/[\\^$.|?*+()[\]{}]/g, (char) => `\\${char}`);
}

/**
 * Word-start regex patterns for the meaningful words of `term`, for use with
 * `column ~* ANY(patterns)`.
 *
 * Empty when the term carries no searchable signal. A caller MUST treat an
 * empty array as "add no word clause" — never as "match everything".
 */
export function wordStartPatterns(term: string): string[] {
  const tokens = queryTokens(normalizeQuery(term).trim().toLowerCase(), 'any');
  return tokens.map((token) => `\\m${escapeRegex(token)}`);
}
