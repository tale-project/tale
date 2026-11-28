/**
 * `llms.txt` builder — follows the spec at https://llmstxt.org/.
 *
 * Produces a single Markdown document that lists every page on the site so
 * AI tools can discover them, grouped into named sections plus an optional
 * "Optional" trailer:
 *
 * ```
 * # <site title>
 *
 * > <site description>
 *
 * ## <section heading>
 *
 * - [<page title>](<absolute url>): <one-line description>
 *
 * ## Optional
 *
 * - [<page title>](<absolute url>)
 * ```
 *
 * Links should point at the `.md` variant of each page so consumers fetch
 * raw markdown without having to scrape HTML.
 */

export interface LlmsTxtPage {
  title: string;
  /** Absolute URL — typically ending in `.md` so consumers fetch markdown. */
  url: string;
  description?: string;
}

export interface LlmsTxtSection {
  heading: string;
  /** Optional intro paragraph between the heading and the page list. */
  intro?: string;
  pages: readonly LlmsTxtPage[];
}

export interface BuildLlmsTxtParams {
  siteTitle: string;
  siteDescription: string;
  /** Intro paragraph between the blockquote and the first section. */
  preamble?: string;
  sections: readonly LlmsTxtSection[];
  /** Pages listed under a trailing `## Optional` section (spec convention). */
  optional?: readonly LlmsTxtPage[];
}

function pageLine(page: LlmsTxtPage): string {
  const desc = page.description ? `: ${page.description}` : '';
  return `- [${page.title}](${page.url})${desc}`;
}

export function buildLlmsTxt({
  siteTitle,
  siteDescription,
  preamble,
  sections,
  optional,
}: BuildLlmsTxtParams): string {
  const lines: string[] = [`# ${siteTitle}`, '', `> ${siteDescription}`, ''];

  if (preamble) {
    lines.push(preamble, '');
  }

  for (const section of sections) {
    lines.push(`## ${section.heading}`, '');
    if (section.intro) lines.push(section.intro, '');
    for (const page of section.pages) lines.push(pageLine(page));
    lines.push('');
  }

  if (optional && optional.length > 0) {
    lines.push('## Optional', '');
    for (const page of optional) lines.push(pageLine(page));
    lines.push('');
  }

  return lines.join('\n');
}
