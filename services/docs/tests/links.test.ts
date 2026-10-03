import { judgeLink } from '@tale/ui/docs/links';
import { describe, it } from 'vitest';

import {
  DOCS_LINK_SITE,
  docsPageFiles,
  readDocsPage,
} from '@/scripts/link-site';

import { assertNoFindings, type Finding } from './lib/findings';
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

/**
 * The whole corpus is parsed with the Markdown renderer's own parser, which
 * takes seconds, not milliseconds, on a busy CI runner — and grows with
 * every page. Each page is parsed once (`readDocsPage`) for its links and
 * for the ids other pages' fragments land on.
 */
const CORPUS_TIMEOUT_MS = 60_000;

describe('links in the docs', () => {
  const pages = docsPageFiles();

  it.each(BASE_LOCALES)(
    'every link under %s/ lands',
    (locale) => {
      const findings: Finding[] = [];
      for (const page of pages.filter(
        (candidate) => candidate.locale === locale,
      )) {
        const { links, anchors: pageAnchors } = readDocsPage(page.file);
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
    },
    CORPUS_TIMEOUT_MS,
  );
});
