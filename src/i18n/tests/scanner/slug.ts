/**
 * Heading-slug computation, mirrored to the docs renderer.
 *
 * The slug algorithm must match what `services/docs/` produces at render
 * time so `markdown-anchor-parity` can resolve `#anchor` links to real
 * headings. The current rule (verified by reading the renderer source):
 *
 *   1. Lowercase.
 *   2. Replace Unicode whitespace with `-`.
 *   3. Strip characters outside `[a-z0-9-_]` (after lowering).
 *   4. Collapse runs of `-` into one.
 *   5. Trim leading/trailing `-`.
 *
 * Locale-aware: German umlauts and the ß are normalised (ä→ae, ö→oe,
 * ü→ue, ß→ss) before stripping. French accents are stripped via NFD
 * decomposition.
 */

export function slugifyHeading(heading: string): string {
  const trimmed = heading.trim();
  const lower = trimmed.toLowerCase();
  const germanNormalized = lower
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  const accentless = germanNormalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dashed = accentless.replace(/\s+/g, '-');
  const stripped = dashed.replace(/[^a-z0-9\-_]/g, '');
  const collapsed = stripped.replace(/-+/g, '-');
  return collapsed.replace(/^-+|-+$/g, '');
}

/** Extract heading-slug pairs from a markdown body. */
export function extractHeadingSlugs(
  body: string,
): ReadonlyMap<string, { line: number; text: string }> {
  const out = new Map<string, { line: number; text: string }>();
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    const text = m[2].trim();
    const slug = slugifyHeading(text);
    if (slug.length === 0) continue;
    out.set(slug, { line: i + 1, text });
  }
  return out;
}
