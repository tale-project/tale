/**
 * Replace `[N]` patterns in markdown text with `<cite>` HTML tags
 * for known citation numbers only.
 *
 * The allowlist approach prevents false positives — only numbers
 * that correspond to actual parsed citations are replaced.
 * Markdown link references like `[1]: url` have a colon after
 * the bracket, so they won't match the in-text pattern.
 */
export function injectCitationTags(
  text: string,
  citationNumbers: Set<number>,
): string {
  if (citationNumbers.size === 0) return text;

  return text.replace(/\[(\d+)\]/g, (match, num: string) => {
    const n = parseInt(num, 10);
    if (citationNumbers.has(n)) {
      return `<cite data-n="${n}"></cite>`;
    }
    return match;
  });
}
