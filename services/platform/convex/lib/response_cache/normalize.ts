/**
 * Text normalization for response cache keys.
 *
 * Only collapses whitespace — punctuation and casing are preserved
 * to avoid false cache hits (e.g. "C++" vs "C", JSON vs plain text).
 */
export function normalizeForCache(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
