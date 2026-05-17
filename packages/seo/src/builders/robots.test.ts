import { describe, expect, it } from 'vitest';

import { buildRobotsTxt } from './robots';

describe('buildRobotsTxt', () => {
  it('emits defaults plus the configured sitemap', () => {
    const out = buildRobotsTxt({ sitemaps: ['https://tale.dev/sitemap.xml'] });
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Allow: /');
    expect(out).toContain('Disallow: /api/');
    expect(out).toContain('Disallow: /_search/');
    // The default output must NOT contain a blanket `Disallow: /` that
    // would override the `Allow: /` directive above.
    expect(out).not.toMatch(/^Disallow: \/$/m);
    expect(out).toContain('Sitemap: https://tale.dev/sitemap.xml');
  });

  it('merges extra disallow entries without duplicating defaults', () => {
    const out = buildRobotsTxt({
      sitemaps: [],
      extraDisallow: ['/api/', '/admin'],
    });
    const apiCount = out.split('\n').filter((l) => l === 'Disallow: /api/');
    expect(apiCount.length).toBe(1);
    expect(out).toContain('Disallow: /admin');
  });

  it('honours custom user agent', () => {
    const out = buildRobotsTxt({
      sitemaps: [],
      userAgent: 'GPTBot',
    });
    expect(out).toContain('User-agent: GPTBot');
  });

  it('keeps sitemap declarations in order', () => {
    const out = buildRobotsTxt({
      sitemaps: [
        'https://tale.dev/sitemap.xml',
        'https://tale.dev/docs/sitemap.xml',
      ],
    });
    const firstIdx = out.indexOf('Sitemap: https://tale.dev/sitemap.xml');
    const secondIdx = out.indexOf('Sitemap: https://tale.dev/docs/sitemap.xml');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });
});
