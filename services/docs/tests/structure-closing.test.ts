import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { stubsForLocale } from './data/heading-stubs';
import { assertNoFindings, type Finding } from './lib/findings';
import { extractClosingSection, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { localeOf, walkDocs } from './lib/walk';

/**
 * Every page closes with a real recap section.
 *
 * From `.claude/skills/docs/SKILL.md` Rule 3:
 *
 *   > The last sub-section is named for what it does (`## Build one`,
 *   > `## Where this fits`, …) and contains at least one paragraph of recap.
 *
 * Two failure modes the test catches:
 *
 *   1. Stub heading — `## Next`, `## See also`, `## Suite`, etc. Locale-aware
 *      via `stubsForLocale`.
 *   2. Single-link body — the closing section's body is one bullet/link line
 *      and nothing else. A "bare links" closing offers no recap.
 *
 * Pages with no headings at all (e.g. `kind: index` landing grids) are
 * exempt — they have no closing section to check.
 */

const SINGLE_LINK_LINE = /^\s*-?\s*\[[^\]]+\]\([^)]+\)\.?\s*$/;

describe('closing paragraph', () => {
  it('every page closes with a real recap, not a stub or bare link', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      const closing = extractClosingSection(body);
      if (!closing) continue;

      const stubs = stubsForLocale(localeOf(rel));
      if (stubs.has(closing.heading.text)) {
        findings.push({
          file: rel,
          line: closing.heading.line,
          rule: 'closing-stub-heading',
          detail: `closing section "${closing.heading.text}" is a stub name — rename for what the section does (e.g. "Build one", "Where this fits")`,
        });
        continue;
      }

      if (
        closing.bodyLines.length === 1 &&
        SINGLE_LINK_LINE.test(closing.bodyLines[0])
      ) {
        findings.push({
          file: rel,
          line: closing.heading.line,
          rule: 'closing-single-link',
          detail: `closing section "${closing.heading.text}" is a single link line — add a one-paragraph recap before the link`,
        });
      }
    }
    assertNoFindings(findings, 'Closing-paragraph issues');
  });
});
