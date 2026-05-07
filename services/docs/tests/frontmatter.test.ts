import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_ROOT, walkDocs } from './_helpers';

const pages = walkDocs();

describe('docs frontmatter', () => {
  it('found at least one page to lint', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('every page has a YAML frontmatter block with title and description', () => {
    const errors: string[] = [];
    for (const rel of pages) {
      const content = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      if (!content.startsWith('---\n')) {
        errors.push(`${rel}: missing frontmatter block`);
        continue;
      }
      const end = content.indexOf('\n---\n', 4);
      if (end === -1) {
        errors.push(`${rel}: unterminated frontmatter block`);
        continue;
      }
      const frontmatter = content.slice(4, end);
      if (!/^title:\s*\S/m.test(frontmatter))
        errors.push(`${rel}: missing 'title'`);
      if (!/^description:\s*\S/m.test(frontmatter))
        errors.push(`${rel}: missing 'description'`);
    }
    expect(
      errors,
      `Frontmatter issues (${errors.length}):\n  ${errors.join('\n  ')}`,
    ).toEqual([]);
  });
});
