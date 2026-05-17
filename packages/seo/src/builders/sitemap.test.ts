import { describe, expect, it } from 'vitest';

import { buildSitemap } from './sitemap';

describe('buildSitemap', () => {
  it('emits an empty <urlset> when given no pages', () => {
    const out = buildSitemap([]);
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(out).toMatch(/<urlset[^>]*>\s*<\/urlset>$/);
  });

  it('emits a single <url> with just <loc>', () => {
    const out = buildSitemap([{ url: 'https://tale.dev/' }]);
    expect(out).toContain('<loc>https://tale.dev/</loc>');
    expect(out).not.toContain('<lastmod>');
    expect(out).not.toContain('<priority>');
    expect(out).not.toContain('xhtml:link');
  });

  it('escapes XML-special characters in URLs', () => {
    const out = buildSitemap([{ url: 'https://tale.dev/foo?bar=1&baz=2' }]);
    expect(out).toContain('https://tale.dev/foo?bar=1&amp;baz=2');
  });

  it('renders lastmod, priority, and changefreq when set', () => {
    const out = buildSitemap([
      {
        url: 'https://tale.dev/',
        lastModified: '2024-01-02T03:04:05Z',
        priority: 0.8,
        changefreq: 'weekly',
      },
    ]);
    expect(out).toContain('<lastmod>2024-01-02T03:04:05Z</lastmod>');
    expect(out).toContain('<priority>0.8</priority>');
    expect(out).toContain('<changefreq>weekly</changefreq>');
  });

  it('emits hreflang alternates and skips empty entries', () => {
    const out = buildSitemap([
      {
        url: 'https://tale.dev/',
        alternates: {
          en: 'https://tale.dev/',
          de: 'https://tale.dev/de',
          'x-default': 'https://tale.dev/',
          fr: undefined,
        },
      },
    ]);
    expect(out).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://tale.dev/" />',
    );
    expect(out).toContain(
      '<xhtml:link rel="alternate" hreflang="de" href="https://tale.dev/de" />',
    );
    expect(out).toContain('hreflang="x-default"');
    expect(out).not.toContain('hreflang="fr"');
  });
});
