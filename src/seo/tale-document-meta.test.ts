import { describe, expect, it } from 'vitest';

import { TALE_SITE_URL } from './globals';
import { resolveTaleDocumentMeta } from './tale-document-meta';

describe('resolveTaleDocumentMeta', () => {
  it('binds the shared marketing OG card and locale tags', () => {
    const resolved = resolveTaleDocumentMeta({
      title: 'Pricing',
      description: 'Plans',
      siteUrl: TALE_SITE_URL,
      canonicalPath: '/pricing',
      locale: 'en',
      alternateLocales: ['en', 'de', 'fr'],
      ogImageAlt: 'Tale — The Orchestrator for AI Agents',
    });

    expect(resolved.defaultOgImage).toBe(`${TALE_SITE_URL}/og.png`);
    expect(resolved.ogImageWidth).toBe(1200);
    expect(resolved.ogImageHeight).toBe(630);
    expect(resolved.ogImageType).toBe('image/png');
    expect(resolved.ogLocale).toBe('en_US');
    expect(resolved.ogLocaleAlternates).toEqual(['de_CH', 'fr_CH']);
    expect(resolved.ogImageAlt).toBe('Tale — The Orchestrator for AI Agents');
  });

  it('maps de → de_CH and omits alternates when none are provided', () => {
    const resolved = resolveTaleDocumentMeta({
      title: 'Docs',
      description: 'Docs',
      siteUrl: 'https://tale.dev/docs',
      canonicalPath: '/de',
      locale: 'de',
      ogImageAlt: 'Tale — Der Orchestrator für KI-Agents',
    });

    expect(resolved.ogLocale).toBe('de_CH');
    expect(resolved.ogLocaleAlternates).toBeUndefined();
    // OG card still comes from the marketing origin.
    expect(resolved.defaultOgImage).toBe(`${TALE_SITE_URL}/og.png`);
    expect(resolved.siteUrl).toBe('https://tale.dev/docs');
  });
});
