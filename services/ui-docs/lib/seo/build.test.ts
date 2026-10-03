import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileToMemory } from '@tale/ui/seo';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { describe, expect, it, vi } from 'vitest';

import * as content from '../../scripts/walk-content';
import { buildUiDocsCompileParams, uiDocsOptionalPages } from './build';

describe('UI documentation discovery', () => {
  it('keeps the sitemap unchanged when a checkout changes only file timestamps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tale-ui-docs-sitemap-'));
    const path = join(dir, 'components', 'button.md');
    try {
      await mkdir(join(dir, 'components'));
      await writeFile(path, '---\ntitle: Button\n---\nStable content.\n');
      await utimes(path, new Date('2020-01-01'), new Date('2020-01-01'));
      const records = await content.listAllContent(dir);
      const walk = vi
        .spyOn(content, 'listAllContent')
        .mockResolvedValue(records);
      try {
        const before = await compileToMemory(await buildUiDocsCompileParams());
        await utimes(path, new Date('2026-10-01'), new Date('2026-10-01'));
        const after = await compileToMemory(await buildUiDocsCompileParams());
        const sitemap = after.get('/sitemap.xml')?.body;

        expect(sitemap).toContain(
          '<loc>https://ui.tale.dev/docs/components/button</loc>',
        );
        expect(sitemap).not.toContain('<lastmod>');
        expect(sitemap).toBe(before.get('/sitemap.xml')?.body);
      } finally {
        walk.mockRestore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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
