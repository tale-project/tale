/**
 * llms-full.txt builder. Emits every page concatenated as:
 *
 *   # <Title>
 *   Source: <absolute URL>
 *
 *   <markdown body>
 *
 *   <blank line>
 *
 * matches the format emitted at https://docs.tale.dev/llms-full.txt so
 * existing consumers stay happy.
 */

export interface LlmsFullTxtPage {
  title: string;
  /** Absolute URL of the canonical (HTML) page. */
  url: string;
  /** Page body as markdown, frontmatter already stripped. */
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
