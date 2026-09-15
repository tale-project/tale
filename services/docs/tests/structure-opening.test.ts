import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractOpeningProse, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/** Require orientation, not a sentence quota. Editorial review judges whether
 * the opening is useful; punctuation counting cannot establish that. Landing
 * grids may use `kind: index` because their cards provide the orientation. */
describe('opening paragraph', () => {
  it('every non-index page has introductory prose', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { frontmatter, body } = parseFrontmatter(raw);
      if (/^kind:\s*index\b/m.test(frontmatter)) continue;
      if (!extractOpeningProse(body)) {
        findings.push({
          file: rel,
          line: 0,
          rule: 'opening-missing',
          detail:
            'add useful introductory prose before the first structural element; one concise sentence can be sufficient',
        });
      }
    }
    assertNoFindings(findings, 'Opening-paragraph issues');
  });

  it('accepts a concise opening without manufacturing a second sentence', () => {
    expect(
      extractOpeningProse(
        'Upload a file to use it in a project.\n\n## Upload\n',
      ),
    ).toBe('Upload a file to use it in a project.');
  });

  it.each([
    '## Upload\nChoose a file.',
    '<!-- Internal author note. Not reader content. -->\n## Upload',
    '![A project file list.](/images/project.webp)\n## Upload',
    '<Frame caption="Project files">\n![Files.](/images/project.webp)\n</Frame>',
    '```bash\ncurl "$URL"\n```',
  ])(
    'does not treat structural or invisible content as an introduction',
    (body) => {
      expect(extractOpeningProse(body)).toBe('');
    },
  );

  it('ignores author comments before a useful opening', () => {
    expect(
      extractOpeningProse(
        '<!-- capture notes -->\n\nChoose who can access the project.\n\n## Access',
      ),
    ).toBe('Choose who can access the project.');
  });
});
