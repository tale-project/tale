/** Tokenise a query for client-side ranking — lowercased, whitespace-split. */
export function rankTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when any punctuation/whitespace-delimited word in `text` starts with
 *  `token` — the signal that ranks "ann" → "Anna Lee" above "Brianna". */
function wordStartsWith(text: string, token: string): boolean {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.length > 0 && word.startsWith(token));
}

/** Match strength of one token against a text: 4 exact, 3 prefix, 2 word-prefix,
 *  1 substring, 0 none. */
function textTier(text: string, token: string): number {
  if (text === token) return 4;
  if (text.startsWith(token)) return 3;
  if (wordStartsWith(text, token)) return 2;
  if (text.includes(token)) return 1;
  return 0;
}

/**
 * Multi-token, word-prefix-aware relevance score of `text` against pre-tokenised
 * query `tokens`. Returns 0 when any token is missing (AND semantics) so it
 * doubles as a filter; a higher score is a stronger match. An empty token list
 * (blank query) scores every text equally at 1.
 *
 * Mirrors the backend `convex/lib/search/relevance` model so client-backed
 * sources (e.g. a bounded thread list) rank the same way server-backed ones do.
 */
export function scoreText(text: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 1;
  const lower = text.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const tier = textTier(lower, token);
    if (tier === 0) return 0;
    total += tier;
  }
  return total;
}
