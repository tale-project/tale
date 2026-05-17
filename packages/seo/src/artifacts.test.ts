import { describe, expect, it } from 'vitest';

import { compileArtifacts, type CompileArtifactsParams } from './artifacts';

const baseParams = (): CompileArtifactsParams => ({
  siteUrl: 'https://tale.dev',
  siteTitle: 'Tale',
  siteDescription: 'Sovereign AI.',
  sections: [
    {
      heading: 'Pages',
      routes: [
        {
          url: '/',
          title: 'Home',
          description: 'Welcome.',
          body: '# Home\n\nWelcome.\n',
        },
        {
          url: '/pricing',
          title: 'Pricing',
          description: 'Plans.',
          body: '# Pricing\n\nPlans.\n',
        },
      ],
    },
  ],
});

describe('compileArtifacts', () => {
  it('emits the expected file set for a basic site', () => {
    const { files } = compileArtifacts(baseParams());
    expect([...files.keys()].sort()).toEqual([
      'index.md',
      'llms-full.txt',
      'llms.txt',
      'pricing.md',
      'robots.txt',
      'sitemap.xml',
    ]);
  });

  it('skips llms-full.txt when no route carries a body', () => {
    const { files } = compileArtifacts({
      ...baseParams(),
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home' }],
        },
      ],
    });
    expect(files.has('llms-full.txt')).toBe(false);
    expect(files.has('index.md')).toBe(false);
  });

  it('omits per-page markdown when disabled', () => {
    const { files } = compileArtifacts({
      ...baseParams(),
      emitPerPageMarkdown: false,
    });
    expect(files.has('index.md')).toBe(false);
    expect(files.has('pricing.md')).toBe(false);
    expect(files.has('llms-full.txt')).toBe(true);
  });

  it('renders `/` as index.md and url path otherwise', () => {
    const { files } = compileArtifacts(baseParams());
    expect(files.get('index.md')).toContain('title: "Home"');
    expect(files.get('pricing.md')).toContain('title: "Pricing"');
  });

  it('points llms.txt links to the .md variant of each route', () => {
    const { files } = compileArtifacts(baseParams());
    const llmsTxt = files.get('llms.txt') ?? '';
    expect(llmsTxt).toContain('https://tale.dev/index.md');
    expect(llmsTxt).toContain('https://tale.dev/pricing.md');
  });

  it('hides routes from llms.txt when `hideFromIndex` is set', () => {
    const params = baseParams();
    const { files } = compileArtifacts({
      ...params,
      sections: [
        ...params.sections,
        {
          heading: 'Locales',
          hideFromIndex: true,
          routes: [
            {
              url: '/de',
              title: 'Startseite',
              body: '# Startseite\n',
            },
          ],
        },
      ],
    });
    const llmsTxt = files.get('llms.txt') ?? '';
    expect(llmsTxt).not.toContain('Locales');
    expect(llmsTxt).not.toContain('Startseite');
    // But the route still appears in sitemap and per-page .md.
    expect(files.get('sitemap.xml') ?? '').toContain('https://tale.dev/de');
    expect(files.has('de.md')).toBe(true);
  });

  it('includes the main sitemap URL in robots.txt by default', () => {
    const { files } = compileArtifacts(baseParams());
    expect(files.get('robots.txt') ?? '').toContain(
      'Sitemap: https://tale.dev/sitemap.xml',
    );
  });

  it('appends extraSitemaps and forwards robots overrides', () => {
    const { files } = compileArtifacts({
      ...baseParams(),
      robots: {
        extraSitemaps: ['https://tale.dev/docs/sitemap.xml'],
        disallow: ['/private'],
        userAgent: 'GPTBot',
      },
    });
    const robots = files.get('robots.txt') ?? '';
    expect(robots).toContain('Sitemap: https://tale.dev/docs/sitemap.xml');
    expect(robots).toContain('Disallow: /private');
    expect(robots).toContain('User-agent: GPTBot');
  });
});
