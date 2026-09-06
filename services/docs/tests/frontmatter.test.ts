import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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

  /**
   * A description over 160 characters is cut off in a search result, so the
   * tail is never read. 281 pages were over; 99 shortened cleanly by dropping
   * a whole trailing sentence or a trailing clause, which leaves grammatical
   * text in all three languages. The rest need a real rewrite per page: their
   * commas separate subordinate clauses, not list items, so cutting at one
   * produces a fragment.
   *
   * This budget is a ratchet. It may go down as pages are rewritten; a change
   * that pushes it up is adding a description nobody will read the end of.
   */
  it('does not grow the backlog of over-long descriptions', () => {
    const MAX = 160;
    const BUDGET = 182;
    const over: string[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      if (!hasFrontmatter(raw)) continue;
      const { frontmatter } = parseFrontmatter(raw);
      if (/^noindex:\s*true/m.test(frontmatter)) continue;
      const match = /^description:\s*(.+)$/m.exec(frontmatter);
      if (match && match[1].trim().length > MAX) over.push(rel);
    }
    expect(
      over.length,
      `over-long descriptions: ${over.length} (budget ${BUDGET})`,
    ).toBeLessThanOrEqual(BUDGET);
  });
});
