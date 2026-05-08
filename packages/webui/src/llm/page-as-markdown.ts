/**
 * Helper that serialises a page back to canonical markdown for the `.md`
 * endpoint and the "Copy as Markdown" button. The page already lives on
 * disk as markdown — this just rewrites relative links to absolute URLs
 * and optionally re-emits a frontmatter block with the canonical fields.
 */

interface RenderParams {
  /** Frontmatter pairs to emit at the top. Pass `null` to skip. */
  frontmatter: Record<string, string | boolean | number> | null;
  /** Markdown body (no leading frontmatter). */
  body: string;
  /** Origin used to absolutise relative links, e.g. `https://docs.tale.dev`. */
  siteUrl: string;
}

function emitFrontmatter(
  fm: Record<string, string | boolean | number>,
): string {
  const lines: string[] = ['---'];
  for (const [key, raw] of Object.entries(fm)) {
    if (typeof raw === 'string') {
      const escaped = raw.replace(/"/g, '\\"');
      lines.push(`${key}: "${escaped}"`);
    } else {
      lines.push(`${key}: ${String(raw)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function rewriteLinks(body: string, siteUrl: string): string {
  // [text](/path) → [text](https://site/path); leaves http(s) and mailto links alone.
  return body.replace(
    /\]\((\/[^)]*?)\)/g,
    (_, path: string) => `](${siteUrl}${path})`,
  );
}

export function pageAsMarkdown({
  frontmatter,
  body,
  siteUrl,
}: RenderParams): string {
  const head = frontmatter ? emitFrontmatter(frontmatter) : '';
  return `${head}${rewriteLinks(body, siteUrl)}`.trimEnd() + '\n';
}
