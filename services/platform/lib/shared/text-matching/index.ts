/**
 * Shared keyword-matcher builder for the TRUSTED built-in detection datasets
 * (reasoning lexicon + routing domain keywords).
 *
 * These datasets are author-maintained literals — not untrusted input — so this
 * module deliberately does NOT carry the ReDoS budget/clamp machinery in
 * `lib/pii/core/regex-safety.ts` (which scans untrusted user/admin content).
 * It unifies the previously-duplicated `escapeRegExp` + longest-first
 * alternation + script-aware boundary logic that the lexicon and domain
 * builders each reimplemented.
 *
 * Pure + zero-IO + runtime-agnostic so it bundles into the Convex V8 runtime.
 */

interface MatcherSpec {
  /** Terms matched with Unicode word boundaries (Latin / Cyrillic / Greek …). */
  wordTerms: Iterable<string>;
  /** Terms matched raw (CJK / Thai — scripts without inter-word spaces). */
  substringTerms: Iterable<string>;
  /**
   * Latin/ASCII terms that must match with ASCII word boundaries
   * (`(?<![A-Za-z0-9])…(?![A-Za-z0-9])`). Use for bare Latin tokens that live in
   * an otherwise substring-mode (CJK/Thai) lexicon: ASCII boundaries stop them
   * matching inside ordinary Latin words ("def" in "definition") while still
   * matching the same token embedded directly in spaceless CJK text ("git" in
   * "gitを使う"), because CJK characters are not ASCII word chars.
   */
  asciiBoundaryTerms?: Iterable<string>;
  /** Regex flags. Default `'iu'` (case-insensitive, Unicode). Use `'giu'` to count. */
  flags?: string;
}

/** Escape regex metacharacters so a literal string can sit inside a pattern. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Longest-first, trimmed, de-duplicated, escaped alternation source (no flags
 * or anchors). Returns `''` for an empty term set. Longest-first ordering makes
 * the alternation prefer the most specific term at a given position.
 */
export function buildAlternation(terms: Iterable<string>): string {
  const merged = new Set<string>();
  for (const t of terms) {
    const trimmed = t.trim();
    if (trimmed.length > 0) merged.add(trimmed);
  }
  if (merged.size === 0) return '';
  return [...merged]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
}

/**
 * "Match anywhere in the text" matcher: word-mode terms are wrapped in Unicode
 * word boundaries (`(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`, so digits count as word
 * chars and `optimize` doesn't fire inside `optimizer`); substring-mode terms
 * match raw. An empty spec yields a never-matching regex (with the same flags,
 * so `.test()`/counting behave consistently).
 */
export function buildAnywhereMatcher(spec: MatcherSpec): RegExp {
  const flags = spec.flags ?? 'iu';
  const word = buildAlternation(spec.wordTerms);
  const sub = buildAlternation(spec.substringTerms);
  const ascii = buildAlternation(spec.asciiBoundaryTerms ?? []);
  const parts: string[] = [];
  if (word) parts.push(`(?<![\\p{L}\\p{N}])(?:${word})(?![\\p{L}\\p{N}])`);
  if (ascii) parts.push(`(?<![A-Za-z0-9])(?:${ascii})(?![A-Za-z0-9])`);
  if (sub) parts.push(`(?:${sub})`);
  if (parts.length === 0) return new RegExp('(?!)', flags);
  return new RegExp(parts.join('|'), flags);
}

/**
 * Whole-message matcher: the entire message (ignoring surrounding whitespace /
 * punctuation) is exactly one of the terms. Used for trivial-ack detection.
 */
export function buildWholeMessageMatcher(spec: MatcherSpec): RegExp {
  const flags = spec.flags ?? 'iu';
  const all = buildAlternation([...spec.wordTerms, ...spec.substringTerms]);
  if (!all) return new RegExp('(?!)', flags);
  return new RegExp(`^[\\s\\p{P}]*(?:${all})[\\s\\p{P}]*$`, flags);
}

/** Count non-overlapping matches of a `g`-flagged matcher in `text` (cap 100). */
export function countMatches(re: RegExp, text: string): number {
  if (!re.global) {
    throw new Error('countMatches requires a regex with the g flag');
  }
  re.lastIndex = 0;
  let n = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    n++;
    if (n > 100) break; // pathological-input guard
    if (match[0].length === 0) re.lastIndex += 1; // never stall on zero-width
  }
  return n;
}
