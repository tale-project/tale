import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractHeadings, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Heading rules from `.agents/skills/write-docs/SKILL.md`:
 *
 *   - **No body H1.** The frontmatter `title` is rendered as the H1; writing
 *     `# X` in the body produces a duplicate H1.
 *   - **Max depth H4.** If the page needs H5/H6, it should be split. The
 *     theme's table of contents stops at H3 anyway.
 *   - Heading wording is editorial. A useful "Next steps" or "Reference"
 *     heading is valid; banning names encourages formulaic replacements.
 *
 * Sentence-case heading enforcement is intentionally NOT in this test —
 * German nouns are always capitalised so "Sentence case" doesn't map cleanly
 * across locales, and EN/FR proper-noun heuristics produce more noise than
 * signal. Reviewers cover sentence-case manually.
 */

describe('heading structure', () => {
  it('every page respects body-H1 and max-H4 rules', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      const headings = extractHeadings(body);

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
      }
    }
    assertNoFindings(findings, 'Heading-structure issues');
  });
});
