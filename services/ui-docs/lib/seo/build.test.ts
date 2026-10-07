import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileToMemory } from '@tale/ui/seo';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import enMessages from '../../messages/en.yml';
import * as content from '../../scripts/walk-content';
import {
  buildUiDocsCompileParams,
  uiDocsOptionalPages,
  UI_DOCS_SITE_DESCRIPTION,
  UI_DOCS_SITE_TITLE,
} from './build';

describe('UI documentation discovery', () => {
  it('keeps artifact and pre-JavaScript metadata aligned with the site catalog', async () => {
    const title = enMessages.seo.siteTitle;
    const description = UI_DOCS_SITE_DESCRIPTION;
    expect(UI_DOCS_SITE_TITLE).toBe(title);

    const dom = new JSDOM(
      await readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    );
    try {
      const { document } = dom.window;
      expect(document.title).toBe(title);
      for (const selector of [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
      ]) {
        expect(
          document.head.querySelector(selector)?.getAttribute('content'),
        ).toBe(description);
      }
    } finally {
      dom.window.close();
    }
  });

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

  it('indexes real guides and omits the retired homepage', async () => {
    const params = await buildUiDocsCompileParams();
    const files = await compileToMemory(params);

    expect(files.get('/sitemap.xml')?.body).not.toContain(
      '<loc>https://ui.tale.dev/</loc>',
    );
    expect(files.get('/sitemap.xml')?.body).toContain(
      '<loc>https://ui.tale.dev/docs/getting-started/introduction</loc>',
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
