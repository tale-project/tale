/**
 * Guards the "prerendered head == live page head" contract. The prerenderer
 * (`renderHeadToHtml`) and the client hook (`applyHeadToDocument`) both
 * consume the *same* `resolveDocumentHead(meta)` output, so this suite pins
 * that one resolver and proves the two emitters stay in agreement.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyHeadToDocument,
  renderHeadToHtml,
  resolveDocumentHead,
  type DocumentHeadInput,
} from './head-tags';

const base: DocumentHeadInput = {
  title: 'Pricing',
  description: 'Two ways to run Tale.',
  canonicalPath: '/pricing',
  siteUrl: 'https://tale.dev',
};

describe('resolveDocumentHead', () => {
  it('suffixes the site name and emits the core SEO tag set', () => {
    const tags = resolveDocumentHead(base);
    expect(tags).toContainEqual({ tag: 'title', text: 'Pricing | Tale' });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'name',
      key: 'description',
      content: 'Two ways to run Tale.',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:title',
      content: 'Pricing | Tale',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'name',
      key: 'robots',
      content: 'index,follow',
    });
    expect(tags).toContainEqual({
      tag: 'link',
      rel: 'canonical',
      href: 'https://tale.dev/pricing',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:url',
      content: 'https://tale.dev/pricing',
    });
  });

  it('does not double-suffix a title that already contains the site name', () => {
    const tags = resolveDocumentHead({ ...base, title: 'Tale: Home' });
    expect(tags.find((t) => t.tag === 'title')).toEqual({
      tag: 'title',
      text: 'Tale: Home',
    });
  });

  it('emits noindex robots and no canonical/og:url for a path-less page', () => {
    const tags = resolveDocumentHead({
      title: 'Legal',
      description: 'x',
      siteUrl: 'https://tale.dev',
      noindex: true,
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'name',
      key: 'robots',
      content: 'noindex,nofollow',
    });
    expect(tags.some((t) => t.tag === 'link' && t.rel === 'canonical')).toBe(
      false,
    );
    expect(tags.some((t) => t.tag === 'meta' && t.key === 'og:url')).toBe(
      false,
    );
  });

  it('strips a trailing slash from the canonical (but keeps root `/`)', () => {
    expect(
      resolveDocumentHead({ ...base, canonicalPath: '/pricing/' }),
    ).toContainEqual({
      tag: 'link',
      rel: 'canonical',
      href: 'https://tale.dev/pricing',
    });
    expect(resolveDocumentHead({ ...base, canonicalPath: '/' })).toContainEqual(
      {
        tag: 'link',
        rel: 'canonical',
        href: 'https://tale.dev/',
      },
    );
  });

  it('emits hreflang alternates (incl. x-default) and JSON-LD scripts', () => {
    const tags = resolveDocumentHead({
      ...base,
      hreflang: {
        locale: 'en',
        alternates: {
          en: 'https://tale.dev/pricing',
          de: 'https://tale.dev/de/pricing',
        },
      },
      jsonLd: ['{"@type":"Article"}'],
    });
    expect(tags).toContainEqual({
      tag: 'link',
      rel: 'alternate',
      href: 'https://tale.dev/de/pricing',
      hreflang: 'de',
    });
    expect(tags).toContainEqual({
      tag: 'link',
      rel: 'alternate',
      href: 'https://tale.dev/pricing',
      hreflang: 'x-default',
    });
    expect(tags).toContainEqual({
      tag: 'script',
      jsonLd: '{"@type":"Article"}',
    });
  });

  it('upgrades twitter:card and adds image tags when an og image is set', () => {
    const tags = resolveDocumentHead({
      ...base,
      defaultOgImage: 'https://tale.dev/og.png',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'name',
      key: 'twitter:card',
      content: 'summary_large_image',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:image',
      content: 'https://tale.dev/og.png',
    });
  });

  it('emits og:image detail and og:locale tags when provided', () => {
    const tags = resolveDocumentHead({
      ...base,
      defaultOgImage: 'https://tale.dev/og.png',
      ogImageAlt: 'Tale — the orchestrator for AI agents',
      ogImageWidth: 1200,
      ogImageHeight: 630,
      ogImageType: 'image/png',
      ogLocale: 'en_US',
      ogLocaleAlternates: ['de_CH', 'fr_CH'],
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:image:alt',
      content: 'Tale — the orchestrator for AI agents',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:image:width',
      content: '1200',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:image:height',
      content: '630',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:image:type',
      content: 'image/png',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'name',
      key: 'twitter:image:alt',
      content: 'Tale — the orchestrator for AI agents',
    });
    expect(tags).toContainEqual({
      tag: 'meta',
      attr: 'property',
      key: 'og:locale',
      content: 'en_US',
    });
    const localeAlternates = tags.filter(
      (t) => t.tag === 'meta' && t.key === 'og:locale:alternate',
    );
    expect(localeAlternates).toHaveLength(2);
  });

  it('omits image detail and locale tags when their inputs are unset', () => {
    const tags = resolveDocumentHead({
      ...base,
      defaultOgImage: 'https://tale.dev/og.png',
    });
    const keys = tags.filter((t) => t.tag === 'meta').map((t) => t.key);
    expect(keys).not.toContain('og:image:alt');
    expect(keys).not.toContain('og:locale');
  });
});

describe('renderHeadToHtml', () => {
  it('serializes and HTML-escapes attribute values', () => {
    const html = renderHeadToHtml(
      resolveDocumentHead({ ...base, description: 'A "quote" & <tag>' }),
    );
    expect(html).toContain('<title>Pricing | Tale</title>');
    expect(html).toContain('content="A &quot;quote&quot; &amp; &lt;tag&gt;"');
    expect(html).toContain(
      '<link rel="canonical" href="https://tale.dev/pricing" />',
    );
  });

  it('escapes `<` and `&` inside JSON-LD so the script cannot break out', () => {
    const html = renderHeadToHtml(
      resolveDocumentHead({ ...base, jsonLd: ['{"a":"</script><b>&"}'] }),
    );
    expect(html).toContain('\\u003c/script');
    expect(html).not.toContain('</script><b>');
  });
});

describe('applyHeadToDocument ↔ renderHeadToHtml parity', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('produces a client DOM that matches the prerendered tags', () => {
    applyHeadToDocument(resolveDocumentHead(base));
    expect(document.title).toBe('Pricing | Tale');
    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute('content'),
    ).toBe('Two ways to run Tale.');
    expect(
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute('href'),
    ).toBe('https://tale.dev/pricing');
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute('content'),
    ).toBe('index,follow');
  });

  it('clears stale alternates + JSON-LD and drops canonical on the next route', () => {
    applyHeadToDocument(
      resolveDocumentHead({
        ...base,
        hreflang: {
          locale: 'en',
          alternates: {
            en: 'https://tale.dev/pricing',
            de: 'https://tale.dev/de/pricing',
          },
        },
        jsonLd: ['{"@type":"Article"}'],
      }),
    );
    expect(
      document.head.querySelectorAll('link[rel="alternate"][hreflang]').length,
    ).toBeGreaterThan(0);
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]')
        .length,
    ).toBe(1);

    // Navigate to a path-less route with no alternates / JSON-LD.
    applyHeadToDocument(
      resolveDocumentHead({
        title: 'X',
        description: 'y',
        siteUrl: 'https://tale.dev',
      }),
    );
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:url"]')).toBeNull();
    expect(
      document.head.querySelectorAll('link[rel="alternate"][hreflang]').length,
    ).toBe(0);
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]')
        .length,
    ).toBe(0);
  });
});
