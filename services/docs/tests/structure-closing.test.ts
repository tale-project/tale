import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractClosingSection, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/** Pages may end with a result, a useful link, code, or reference data. The
 * mechanical defect is an empty final section, not the absence of a recap. */
describe('final section', () => {
  it('does not leave a final heading without content', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      const closing = extractClosingSection(body);
      if (closing && closing.bodyLines.length === 0) {
        findings.push({
          file: rel,
          line: closing.heading.line,
          rule: 'closing-empty-section',
          detail: `section "${closing.heading.text}" has no content; complete or remove it`,
        });
      }
    }
    assertNoFindings(findings, 'Final-section issues');
  });

  it.each([
    '## Result\nThe file appears in the project list.',
    '## Next steps\n[Use the file in a chat](/platform/chat/basics)',
    '## Example\n```json\n{"limit": 10}\n```',
    '## Values\n| Name | Value |\n| --- | --- |\n| Limit | 10 |',
  ])('allows useful endings without a recap', (body) => {
    expect(extractClosingSection(body)?.bodyLines.length).toBeGreaterThan(0);
  });

  it.each(['## Next steps\n', '## Example\n<!-- Pending example. -->'])(
    'rejects an empty or comment-only final section',
    (body) => {
      expect(extractClosingSection(body)?.bodyLines).toEqual([]);
    },
  );

  it('does not treat a heading inside an author comment as a section', () => {
    expect(
      extractClosingSection('## Result\nReady.\n<!--\n## Future work\n-->')
        ?.heading.text,
    ).toBe('Result');
  });

  it('does not require a closing section on a page without headings', () => {
    expect(extractClosingSection('Choose a project to continue.')).toBeNull();
  });
});
