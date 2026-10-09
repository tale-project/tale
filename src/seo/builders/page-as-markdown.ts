/**
 * Serialises a page back to canonical markdown for the `.md` endpoint and
 * the "Copy as Markdown" button. The page already lives on disk as
 * markdown — this just rewrites relative links to absolute URLs and
 * optionally re-emits a frontmatter block with canonical fields.
 */

import { absoluteSitePath } from '../urls';
import { normalizeMarkdownLinks } from './markdown-links';

interface RenderParams {
  /** Frontmatter pairs to emit at the top. Pass `null` to skip. */
  frontmatter: Record<string, string | boolean | number> | null;
  /** Markdown body — no leading frontmatter. */
  body: string;
  /** Site base, including any mount path, used for slash-root destinations. */
  siteUrl: string;
  /** Canonical HTML URL for page-relative links and fragments. */
  pageUrl?: string;
}

/**
 * Escape a string value for a YAML double-quoted scalar. Handles
 * backslash, double quote, and the control characters that would
 * otherwise break the scalar (literal newline / CR / tab inside a
 * double-quoted string is a YAML 1.2 syntax error). The backslash pass
 * runs first so we don't double-escape the slashes we add for `"`,
 * `\n`, etc.
 */
function yamlDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function emitFrontmatter(
  fm: Record<string, string | boolean | number>,
): string {
  const lines: string[] = ['---'];
  for (const [key, raw] of Object.entries(fm)) {
    if (typeof raw === 'string') {
      lines.push(`${key}: "${yamlDoubleQuoted(raw)}"`);
    } else {
      lines.push(`${key}: ${String(raw)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function pageAsMarkdown({
  frontmatter,
  body,
  siteUrl,
  pageUrl,
}: RenderParams): string {
  const head = frontmatter ? emitFrontmatter(frontmatter) : '';
  const sourceUrl = pageUrl ?? absoluteSitePath(siteUrl, '/');
  return (
    `${head}${normalizeMarkdownLinks(body, sourceUrl, siteUrl)}`.trimEnd() +
    '\n'
  );
}
