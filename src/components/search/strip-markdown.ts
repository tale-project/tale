/** Strip markdown to plain text. Keeps inline links' visible text and the
 *  text of inline code — an error code, a header name or an environment
 *  variable is exactly what a developer searches for. Emphasis markers go
 *  only where they delimit a word (`*bold*`, `_em_`, `~del~`); an underscore
 *  inside an identifier (`ORG_SLUG_REQUIRED`) is part of the name. */
export function stripMarkdown(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, ' $1 ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^>\s*/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      // Heading-anchor extensions like `### Title {#anchor}` — drop the
      // `{#anchor}` syntax so it doesn't bleed into search snippets.
      .replace(/\s*\{#[^}]+\}/g, '')
      // Markdown table separator rows (`| --- | --- |`) and the table pipes
      // themselves — keep the cell text but drop the visual delimiter so a
      // snippet reads like prose instead of `| col1 | col2 |`.
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, ' ')
      .replace(/\|/g, ' ')
      // List bullets, then emphasis delimiters: an opening run after a
      // space or bracket, a closing run before space or punctuation.
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/(^|[\s([{])[*_~]{1,3}(?=\S)/g, '$1')
      .replace(/(?<=\S)[*_~]{1,3}(?=[\s)\]}.,;:!?]|$)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
