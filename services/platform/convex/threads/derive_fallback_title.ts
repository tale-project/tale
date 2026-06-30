const FALLBACK_TITLE_MAX_LEN = 60;

/**
 * Derive a thread title from the user's first message when AI title generation
 * produces nothing (failure / timeout / empty response). Collapses whitespace
 * and truncates with an ellipsis.
 *
 * Returns `null` for an empty source so the caller keeps the thread's default
 * "New Chat" title rather than setting a blank one. Preferring the user's first
 * message over leaving the generic default keeps each thread distinctive — see
 * #1981, where deterministic/empty AI titles left many threads identically
 * named.
 */
export function deriveFallbackTitle(source: string): string | null {
  const cleaned = source.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > FALLBACK_TITLE_MAX_LEN
    ? `${cleaned.slice(0, FALLBACK_TITLE_MAX_LEN).trimEnd()}…`
    : cleaned;
}
