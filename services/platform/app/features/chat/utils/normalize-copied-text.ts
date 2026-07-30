/**
 * Squash the whitespace artifacts that copying rendered chat markdown leaves
 * in a `text/plain` serialization.
 *
 * Assistant replies render as nested block structure — the answer is split
 * into sections, each section into paragraphs, each paragraph into markdown
 * block elements. When the browser serializes a selection to plain text it
 * inserts a line break at *every* block boundary, so those nested wrappers
 * stack up three or four blank lines between paragraphs. Pasted into the
 * composer (or another chat) that reads as "a bunch of random newlines".
 *
 * Normalize by collapsing runs of 3+ newlines to a single blank line, stripping
 * per-line trailing horizontal whitespace, and trimming the ends. Intentional
 * structure — single newlines and one-blank-line paragraph breaks — is kept.
 */
export function normalizeCopiedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n') // CRLF / lone CR → LF
    .replace(/[^\S\n]+\n/g, '\n') // trailing spaces/tabs before a newline
    .replace(/\n{3,}/g, '\n\n') // 3+ newlines → one blank line
    .trim();
}
