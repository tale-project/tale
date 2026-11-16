/**
 * Estimate reading time for a markdown string.
 *
 * Counts whitespace-separated tokens and divides by 220 words-per-minute —
 * the rough mid-point for adult prose reading speed. The result is rounded
 * up so even a one-paragraph page reports `1 min read` instead of `0`.
 *
 * Code fences, inline code, and HTML tags are stripped before counting so
 * that blocks of source code don't artificially inflate the estimate.
 */
const WORDS_PER_MINUTE = 220;

export function readingTimeMinutes(markdown: string): number {
  const stripped = markdown
    // fenced code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // inline code
    .replace(/`[^`]*`/g, ' ')
    // raw HTML / JSX tags
    .replace(/<[^>]+>/g, ' ');

  const words = stripped
    .split(/\s+/)
    .filter((token) => token.length > 0).length;

  if (words === 0) return 1;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
