import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeLink, readPage } from '@tale/ui/docs/links';
import { describe, expect, it } from 'vitest';

import { UI_DOCS_LINK_SITE, uiDocsPageFiles } from '@/scripts/link-site';

/**
 * Every link a guide renders must land, judged against what ui.tale.dev
 * answers (`scripts/link-site.ts`) with the documentation frame's link rules
 * (`@tale/ui/docs/links`): no 404 (`link-target-missing`), no moved guide
 * or section folder (`link-via-redirect` — link the guide itself), and every
 * `#fragment` a heading or id the target renders (`fragment-missing`).
 * Links into the guides from the rest of the repository are judged by
 * `bun run lint:links`.
 */

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

describe('links in the guides', () => {
  it('every link lands', async () => {
    const findings: string[] = [];
    for (const page of uiDocsPageFiles()) {
      const source = await readFile(resolve(REPO_ROOT, page.file), 'utf8');
      const { links, anchors: pageAnchors } = readPage(source);
      for (const link of links) {
        const problem = judgeLink(link.url, {
          pageUrl: page.url,
          pageAnchors,
          sites: [UI_DOCS_LINK_SITE],
        });
        if (problem) {
          findings.push(
            `${page.file}:${link.line} [${problem.rule}] "${link.url}": ${problem.detail}`,
          );
        }
      }
    }
    expect(findings, 'broken links in services/ui-docs/content').toEqual([]);
  });
});
