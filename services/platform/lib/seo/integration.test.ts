/**
 * Integration test for the platform SEO pipeline. The platform's
 * artifact set is synthetic, so we can drive the full plugin pipeline
 * in-process and assert byte-level output without any temp-disk dance.
 */

import { compileToMemory } from '@tale/seo';
import { describe, expect, it } from 'vitest';

import platformSeoConfig from '../../scripts/seo.config';

describe('platform SEO integration', () => {
  it('emits the platform artifact set', async () => {
    const result = await compileToMemory(platformSeoConfig());
    const paths = [...result.keys()].sort();
    expect(paths).toContain('/llms.txt');
    expect(paths).toContain('/llms-full.txt');
    expect(paths).toContain('/robots.txt');
    // The synthetic `/platform` route has a body, so the page-markdown
    // plugin emits one .md plus a sitemap entry — the platform's
    // server.ts only routes the three text paths above to the artifact
    // handler, but the file set produced here mirrors what every other
    // service emits.
    expect(paths).toContain('/platform.md');
  });

  it('robots.txt blocks all crawlers', async () => {
    const result = await compileToMemory(platformSeoConfig());
    const robots = result.get('/robots.txt')?.body ?? '';
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Disallow: /');
  });

  it('llms.txt lists cross-links under Optional', async () => {
    const result = await compileToMemory(platformSeoConfig());
    const llms = result.get('/llms.txt')?.body ?? '';
    expect(llms).toContain('## Optional');
    expect(llms).toContain('GitHub');
    expect(llms).toContain('Documentation');
  });

  it('llms-full.txt contains the platform explanatory body', async () => {
    const result = await compileToMemory(platformSeoConfig());
    const full = result.get('/llms-full.txt')?.body ?? '';
    expect(full).toContain('authenticated product');
  });
});
