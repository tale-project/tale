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

export interface LlmsFullTxtPage {
  title: string;
  /** Absolute URL of the canonical HTML page. */
  url: string;
  /** Page body as markdown — frontmatter already stripped. */
  body: string;
}

export function buildLlmsFullTxt(pages: readonly LlmsFullTxtPage[]): string {
  return pages
    .map((page) =>
      [`# ${page.title}`, `Source: ${page.url}`, '', page.body.trim(), ''].join(
        '\n',
      ),
    )
    .join('\n');
}
