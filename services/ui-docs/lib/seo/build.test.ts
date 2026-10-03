import { compileToMemory } from '@tale/ui/seo';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { describe, expect, it } from 'vitest';

import { buildUiDocsCompileParams, uiDocsOptionalPages } from './build';

describe('UI documentation discovery', () => {
  it('includes the indexable homepage without advertising a missing Markdown twin', async () => {
    const params = await buildUiDocsCompileParams();
    const files = await compileToMemory(params);

    expect(files.get('/sitemap.xml')?.body).toContain(
      '<loc>https://ui.tale.dev/</loc>',
    );
    expect(files.get('/llms.txt')?.body).not.toContain(
      new URL('/index.md', params.siteUrl).href,
    );
    expect(files.has('/index.md')).toBe(false);
  });

  it('links directly to the canonical product documentation', () => {
    expect(uiDocsOptionalPages()).toContainEqual({
      title: 'Tale documentation',
      url: TALE_DOCS_URL,
    });
  });
});
