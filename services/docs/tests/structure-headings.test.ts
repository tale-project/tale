import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { stubsForLocale } from './data/heading-stubs';
import { assertNoFindings, type Finding } from './lib/findings';
import { extractHeadings, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { localeOf, walkDocs } from './lib/walk';

/**
 * Heading rules from `.claude/skills/docs/SKILL.md`:
 *
 *   - **No body H1.** The frontmatter `title` is rendered as the H1; writing
 *     `# X` in the body produces a duplicate H1.
 *   - **Max depth H4.** If the page needs H5/H6, it should be split. The
 *     theme's table of contents stops at H3 anyway.
 *   - **No stub heading names anywhere.** `## Next`, `## See also`, `## Suite`
 *     fail review whether they're the last heading or in the middle of the
 *     page. The closing-section test catches them at the end; this test
 *     catches them everywhere else.
 *
 * Sentence-case heading enforcement is intentionally NOT in this test —
 * German nouns are always capitalised so "Sentence case" doesn't map cleanly
 * across locales, and EN/FR proper-noun heuristics produce more noise than
 * signal. Reviewers cover sentence-case manually.
 */

describe('heading structure', () => {
  it('every page respects body-H1, max-H4, and no-stub rules', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      const headings = extractHeadings(body);
      const stubs = stubsForLocale(localeOf(rel));

      for (const h of headings) {
        if (h.depth === 1) {
          findings.push({
            file: rel,
            line: h.line,
            rule: 'heading-body-h1',
            detail: `body must not contain "# ${h.text}" — frontmatter \`title\` renders the H1`,
          });
        }
        if (h.depth > 4) {
          findings.push({
            file: rel,
            line: h.line,
            rule: 'heading-too-deep',
            detail: `heading depth H${h.depth} exceeds max H4; split the page`,
          });
        }
        if (stubs.has(h.text)) {
          findings.push({
            file: rel,
            line: h.line,
            rule: 'heading-stub-name',
            detail: `heading "${h.text}" is a stub name; rename for what the section does (e.g. "Where this fits", "Build one")`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Heading-structure issues');
  });
});
