/**
 * `llms-full.txt` builder — concatenates every page's markdown body into a
 * single document AI tools can fetch in one request.
 *
 * Output format (one block per page):
 *
 * ```
 * # <Title>
 * Source: <absolute URL>
 *
 * <markdown body>
 *
 * <blank line>
 * ```
 *
 * Matches the canonical Tale output (e.g. https://tale.dev/docs/llms-full.txt)
 * so existing consumers stay happy.
 */

import { normalizeMarkdownLinks } from './markdown-links';

export interface LlmsFullTxtPage {
  title: string;
  /** Absolute URL of the canonical HTML page. */
  url: string;
  /** Page body as markdown — frontmatter already stripped. */
  body: string;
}

export function buildLlmsFullTxt(
  pages: readonly LlmsFullTxtPage[],
  /** Configured site mount for slash-root destinations; otherwise each page uses its origin. */
  siteUrl?: string,
): string {
  return pages
    .map((page) =>
      [
        `# ${page.title}`,
        `Source: ${page.url}`,
        '',
        normalizeMarkdownLinks(page.body, page.url, siteUrl).trim(),
        '',
      ].join('\n'),
    )
    .join('\n');
}
