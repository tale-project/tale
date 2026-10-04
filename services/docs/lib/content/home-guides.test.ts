import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HOME_GUIDES } from './home-guides';
import { getDocPage } from './loader';
import { docPath } from './paths';

const slugs = [
  HOME_GUIDES.featured,
  ...HOME_GUIDES.paths,
  ...HOME_GUIDES.tutorials,
  ...HOME_GUIDES.reference,
  'get-started/quickstart',
  'self-hosted/install/quickstart',
  'platform/projects/tasks',
  'platform/projects/task-automation',
  'tutorials/overview',
];

for (const locale of ['en', 'de', 'fr'] as const) {
  describe(`${locale} discovery paths`, () => {
    it('leads to complete localized guides also carried by the published Markdown homepage', () => {
      const markdown = readFileSync(
        new URL(`../../../../docs/${locale}/index.md`, import.meta.url),
        'utf8',
      );
      for (const slug of slugs) {
        const page = getDocPage(locale, slug);
        expect(page, slug).not.toBeNull();
        expect(page?.locale, slug).toBe(locale);
        expect(page?.frontmatter.title, slug).toBeTruthy();
        expect(page?.frontmatter.description, slug).toBeTruthy();
        expect(markdown, slug).toContain(docPath(locale, slug));
      }
    });
  });
}
