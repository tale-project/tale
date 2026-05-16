import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { hasFrontmatter, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Every page must declare a frontmatter block with `title` and `description`.
 *
 * The docs theme reads both fields — `title` becomes the `<h1>`, `description`
 * becomes the `<meta>` and the search-index snippet. A page missing either
 * renders without a title or without a search hit.
 */

describe('frontmatter', () => {
  it('every page has a YAML frontmatter block with title and description', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');

      if (!hasFrontmatter(raw)) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'frontmatter-missing',
          detail: 'page must start with a `---` frontmatter block',
        });
        continue;
      }

      const { frontmatter } = parseFrontmatter(raw);
      if (!/^title:\s*\S/m.test(frontmatter)) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'frontmatter-title-missing',
          detail: 'frontmatter must declare `title`',
        });
      }
      if (!/^description:\s*\S/m.test(frontmatter)) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'frontmatter-description-missing',
          detail: 'frontmatter must declare `description`',
        });
      }
    }
    assertNoFindings(findings, 'Frontmatter issues');
  });
});
