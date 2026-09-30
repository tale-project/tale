import fs from 'node:fs';
import path from 'node:path';

import { judgeLink, readPage } from '@tale/ui/docs/links';
import { describe, it } from 'vitest';

import { DOCS_LINK_SITE, docsPageFiles } from '@/scripts/link-site';

import { assertNoFindings, type Finding } from './lib/findings';
import { REPO_ROOT } from './lib/paths';
import { BASE_LOCALES } from './lib/walk';

/**
 * Every link a docs page renders must land. The links are read with the
 * renderer's own parser (`@tale/ui/docs/links`): inline and reference links,
 * autolinks, images, and the `href` / `src` of raw component tags such as
 * `<Card href>` — never an example inside code. Each resolves the way a
 * browser resolves it, against the page's own URL, and is judged against
 * what docs.tale.dev answers (`scripts/link-site.ts`):
 *
 *   - `link-target-missing` — the address is a 404 (the finding names the
 *     closest page);
 *   - `link-via-redirect` — the address is a moved page or a section folder:
 *     link the page the redirect lands on;
 *   - `fragment-missing` — the `#fragment` is no heading or id the target
 *     renders (use the renderer's slug, or keep the old `{#id}` when
 *     renaming a section);
 *   - `link-locale-switch` — a German or French page links a page in
 *     another language; keep the reader in the page's own tree.
 *
 * External addresses are out of scope here; links into the docs from the
 * rest of the repository are judged by `bun run lint:links`.
 */

describe('links in the docs', () => {
  const pages = docsPageFiles();

  it.each(BASE_LOCALES)('every link under %s/ lands', (locale) => {
    const findings: Finding[] = [];
    for (const page of pages.filter(
      (candidate) => candidate.locale === locale,
    )) {
      const source = fs.readFileSync(path.join(REPO_ROOT, page.file), 'utf8');
      const { links, anchors: pageAnchors } = readPage(source);
      for (const link of links) {
        const problem = judgeLink(link.url, {
          pageUrl: page.url,
          pageLocale: locale,
          pageAnchors,
          sites: [DOCS_LINK_SITE],
        });
        if (!problem) continue;
        findings.push({
          file: page.file.replace(/^docs\//, ''),
          line: link.line,
          rule: problem.rule,
          detail: `"${link.url}": ${problem.detail}`,
        });
      }
    }
    assertNoFindings(findings, `Broken links under ${locale}/`);
  });
});
