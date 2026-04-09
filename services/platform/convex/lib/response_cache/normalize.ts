/**
 * Text normalization for response cache keys.
 *
 * Normalizes text so that queries differing only in casing,
 * punctuation, or whitespace map to the same cache key.
 */
export function normalizeForCache(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation → space (preserves Unicode letters & digits)
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}
