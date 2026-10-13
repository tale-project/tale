/**
 * The fallback thread title, derived from the user's first message when AI
 * generation produces nothing (failure / timeout / empty reply). Preferring a
 * trimmed slice of the user's own words over a generic default keeps every
 * thread distinctive — a wall of identically-named conversations is exactly
 * what the title exists to prevent.
 *
 * Layer A: pure, no `node:*`, no Convex.
 */

const FALLBACK_TITLE_MAX_LEN = 60;

/**
 * Collapse whitespace and truncate with an ellipsis. Returns `null` for an
 * all-whitespace source so the caller keeps the thread untitled (the UI's
 * "Untitled chat" fallback) rather than setting a blank title.
 */
export function deriveFallbackTitle(source: string): string | null {
  const cleaned = source.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > FALLBACK_TITLE_MAX_LEN
    ? `${cleaned.slice(0, FALLBACK_TITLE_MAX_LEN).trimEnd()}…`
    : cleaned;
}
