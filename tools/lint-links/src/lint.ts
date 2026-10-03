/**
 * The link gate over the whole repository. Two passes, one set of rules
 * (`judgeLink` from `@tale/ui/docs/links`):
 *
 *  1. every content page of every documentation site — each link the page
 *     renders, resolved against the page's own URL and judged by the site
 *     it points at (its own, or another judged site);
 *  2. every other tracked text file — each absolute address on a judged
 *     origin, and each docs path the code builds (`./references.ts`), so an
 *     in-app help link, a README or the marketing site cannot point at a
 *     page that moved or never existed.
 */

import {
  judgeLink,
  readPage,
  type LinkSite,
  type LinkSiteModule,
} from '@tale/ui/docs/links';

import { docsPathReferences, originReferences } from './references';

export interface Finding {
  file: string;
  line: number;
  column: number;
  rule: string;
  detail: string;
}

export interface LintInput {
  /** The documentation sites, each with its content pages. */
  modules: readonly LinkSiteModule[];
  /** Every tracked file to scan, repository-relative. */
  files: readonly string[];
  /** The text of a file, or null when it is not text (binary, too large). */
  read: (file: string) => string | null;
  /** The origin docs paths built in code are appended to. */
  docsOrigin: string;
  /** Files never scanned for references (generated history, lockfiles). */
  skip?: (file: string) => boolean;
}

/** Judge every content page and every reference into the judged sites. */
export function lintLinks(input: LintInput): Finding[] {
  const sites: LinkSite[] = input.modules.map(({ site }) => site);
  const findings: Finding[] = [];

  for (const module of input.modules) {
    for (const page of module.pages()) {
      const source = input.read(page.file);
      if (source === null) continue;
      const { links, anchors } = readPage(source);
      for (const link of links) {
        const problem = judgeLink(link.url, {
          pageUrl: page.url,
          pageLocale: page.locale,
          pageAnchors: anchors,
          sites,
        });
        if (problem) {
          findings.push({
            file: page.file,
            line: link.line,
            column: link.column,
            rule: problem.rule,
            detail: `"${link.url}": ${problem.detail}`,
          });
        }
      }
    }
  }

  const contentRoots = input.modules.map(({ contentRoot }) => contentRoot);
  const origins = sites.flatMap((site) => site.origins);
  for (const file of input.files) {
    if (contentRoots.some((root) => file.startsWith(root))) continue;
    if (input.skip?.(file)) continue;
    const text = input.read(file);
    if (text === null) continue;
    const references = [
      ...originReferences(text, origins),
      ...docsPathReferences(file, text, input.docsOrigin),
    ];
    for (const reference of references) {
      // Absolute addresses resolve on their own; the page URL only matters
      // for a relative one, and references are never relative.
      const problem = judgeLink(reference.url, {
        pageUrl: reference.url,
        sites,
      });
      if (problem) {
        findings.push({
          file,
          line: reference.line,
          column: reference.column,
          rule: problem.rule,
          detail: `"${reference.url}": ${problem.detail}`,
        });
      }
    }
  }
  return findings;
}
