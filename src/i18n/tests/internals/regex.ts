/**
 * Small regex helpers used by checks and locale data files.
 */

/** Escape a string for use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary RegExp around a literal term. Locale-agnostic ASCII boundary. */
export function wordBoundary(term: string, flags = 'g'): RegExp {
  return new RegExp(`\\b${escapeRegex(term)}\\b`, flags);
}

/** German word-boundary that treats umlauts and ß as part of a word. */
export function wordBoundaryDe(term: string, flags = 'g'): RegExp {
  const before = `(?<![A-Za-zÄÖÜäöüß])`;
  const after = `(?![A-Za-zÄÖÜäöüß])`;
  return new RegExp(`${before}${escapeRegex(term)}${after}`, flags);
}

/** French word-boundary that treats accented letters as part of a word. */
export function wordBoundaryFr(term: string, flags = 'g'): RegExp {
  const before = `(?<![A-Za-zÀ-ÖØ-öø-ÿ])`;
  const after = `(?![A-Za-zÀ-ÖØ-öø-ÿ])`;
  return new RegExp(`${before}${escapeRegex(term)}${after}`, flags);
}
