import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMarketingContent } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('marketing content client loader', () => {
  it('loads only the requested localized body in explicit dev preview', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_MARKETING_CONTENT_PREVIEW', 'true');
    const { loadMarketingContent, listMarketingContent } =
      await import('./client');
    const entries = listMarketingContent('comparisons', 'de');
    expect(entries).toHaveLength(
      readMarketingContent().filter(
        (page) => page.category === 'comparisons' && page.locale === 'de',
      ).length,
    );
    expect(entries.every((entry) => !('content' in entry))).toBe(true);
    const page = await loadMarketingContent({
      category: 'comparisons',
      locale: 'de',
      slug: 'tale-vs-multica',
    });
    expect(page?.content.length).toBeGreaterThan(100);
    expect(page?.url).toBe('/de/compare/tale-vs-multica');
    expect(page?.content).not.toMatch(/^---/);
    expect(
      await loadMarketingContent({
        category: 'comparisons',
        locale: 'es',
        slug: 'tale-vs-multica',
      }),
    ).toBeNull();
    expect(
      await loadMarketingContent({
        category: 'comparisons',
        locale: 'de',
        slug: '../../legal/en/privacy-policy',
      }),
    ).toBeNull();
    expect(
      await loadMarketingContent({
        category: 'use-cases',
        locale: 'en',
        slug: 'not-a-page',
      }),
    ).toBeNull();
  }, 15_000);

  it('never enables production draft preview even when the flag is set', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_MARKETING_CONTENT_PREVIEW', 'true');
    const { MARKETING_CONTENT_PREVIEW } = await import('./client');
    expect(MARKETING_CONTENT_PREVIEW).toBe(false);
  });
});
