/**
 * llms.txt builder following the spec at https://llmstxt.org/.
 *
 * Emits:
 *
 *   # <site title>
 *
 *   > <site description>
 *
 *   ## <section heading>
 *
 *   - [<page title>](<url>): <one-line page description>
 */

export interface LlmsTxtSection {
  heading: string;
  /** Optional intro paragraph below the heading. */
  intro?: string;
  pages: readonly LlmsTxtPage[];
}

export interface LlmsTxtPage {
  title: string;
  /** Absolute URL ending in `.md` so AI tools fetch raw markdown. */
  url: string;
  description?: string;
}

interface BuildParams {
  siteTitle: string;
  siteDescription: string;
  /** Optional intro paragraph between blockquote and the first section. */
  preamble?: string;
  sections: readonly LlmsTxtSection[];
  /** Optional `## Optional` section listed last (per the spec's convention). */
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
}: BuildParams): string {
  const lines: string[] = [`# ${siteTitle}`, '', `> ${siteDescription}`, ''];
  if (preamble) {
    lines.push(preamble, '');
  }
  for (const section of sections) {
    lines.push(`## ${section.heading}`, '');
    if (section.intro) lines.push(section.intro, '');
    for (const page of section.pages) {
      lines.push(pageLine(page));
    }
    lines.push('');
  }
  if (optional && optional.length > 0) {
    lines.push('## Optional', '');
    for (const page of optional) {
      lines.push(pageLine(page));
    }
    lines.push('');
  }
  return lines.join('\n');
}
