/**
 * Heading ids, as `AnchoredHeading` renders them — the one rule every reader
 * of a heading's address derives them with: the "on this page" outline
 * (`extract-toc`) and the docs link lint (`@tale/ui/docs/links`). Plain
 * strings, no React, so a build script or a lint can use it.
 */

/**
 * Pandoc-style explicit-id syntax at the end of a heading. Matches the
 * trailing token `{#some-id}` (optionally with surrounding whitespace) so
 * authors can override the auto-generated slug — handy for stable anchor
 * URLs across renames or non-Latin headings.
 */
export const EXPLICIT_ID_PATTERN = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/;

/** GitHub-style heading slug of a heading's text: lower-case, alphanumerics + hyphens. */
export function slugifyHeadingText(text: string): string {
  const slug = text
    .toLowerCase()
    // German transliteration before NFKD strips diacritics, so "Größe"
    // becomes "groesse" instead of colliding with "große" -> "groe".
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    // Strip combining diacritical marks (U+0300..U+036F).
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  // Fallback for headings whose characters are entirely stripped (e.g.
  // CJK-only). Without this, multiple such headings would all collide
  // on the empty string and break in-page anchors.
  return slug || 'section';
}
