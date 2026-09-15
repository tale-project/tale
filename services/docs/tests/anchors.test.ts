import fs from 'node:fs';
import path from 'node:path';

import { extractToc } from '@tale/ui/markdown/extract-toc';
import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { stripFences } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, walkDocs } from './lib/walk';

// Reuse the renderer's heading IDs: a translated heading is not necessarily
// its fragment (accents and punctuation are normalized). Explicit heading IDs
// preserve old incoming links after a section is renamed.
function pageAnchors(body: string): Set<string> {
  const clean = stripFences(body).replace(/<!--[\s\S]*?-->/g, '');
  return new Set(
    // H4 is rendered with the same anchor component, but omitted from the
    // right-rail TOC. Promote it only for this shared ID extraction.
    extractToc(clean.replace(/^####(\s)/gm, '###$1')).map((entry) => entry.id),
  );
}

describe('section link targets', () => {
  it.each(BASE_LOCALES)(
    'every internal fragment under %s/ reaches an existing section',
    (locale) => {
      const pages = new Map(
        walkDocs()
          .filter((file) => file.startsWith(`${locale}/`))
          .map((file) => [
            file,
            fs.readFileSync(path.join(CONTENT_ROOT, file), 'utf8'),
          ]),
      );
      const anchors = new Map(
        Array.from(pages, ([file, body]) => [file, pageAnchors(body)]),
      );
      const findings: Finding[] = [];
      for (const [file, body] of pages) {
        const lines = stripFences(body).split('\n');
        for (const [index, line] of lines.entries()) {
          for (const match of line.matchAll(
            /\]\(([^\s)]+)\)|\bhref=["']([^"']+)["']/g,
          )) {
            const url = match[1] ?? match[2];
            if (!url.includes('#') || /^(?:https?:|mailto:)/.test(url)) {
              continue;
            }
            const [route, fragment] = url.split('#', 2);
            if (!fragment) continue;
            const slug = route
              .split('?')[0]
              .replace(/^\//, '')
              .replace(new RegExp(`^${locale}/`), '')
              .replace(/\.mdx?$/, '')
              .replace(/\/$/, '');
            const candidates = route
              ? [
                  `${locale}/${slug}.md`,
                  `${locale}/${slug}.mdx`,
                  `${locale}/${slug}/index.md`,
                  `${locale}/${slug}/index.mdx`,
                ]
              : [file];
            const target = candidates.find((candidate) => pages.has(candidate));
            if (
              target &&
              anchors.get(target)?.has(decodeURIComponent(fragment))
            ) {
              continue;
            }
            findings.push({
              file,
              line: index + 1,
              rule: 'section-target-missing',
              detail: `"${url}" has no matching section in ${target ?? candidates[0]}`,
            });
          }
        }
      }
      assertNoFindings(findings, `Broken section links under ${locale}/`);
    },
  );
});
