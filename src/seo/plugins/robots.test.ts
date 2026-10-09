import { describe, expect, it } from 'vitest';

import type { BuildContext } from '../runtime/plugin';
import type { ResolvedRoutes, RobotsConfig } from '../types';
import { ROBOTS_PATH, robotsPlugin } from './robots';

function makeCtx(routes: ResolvedRoutes, robots?: RobotsConfig): BuildContext {
  return {
    siteUrl: 'https://tale.dev',
    siteTitle: 'Tale',
    siteDescription: 'Sovereign AI.',
    robots,
    routes: async () => routes,
    body: async () => null,
  };
}

describe('robotsPlugin', () => {
  it('always emits — even for services with no routes', async () => {
    const ctx = makeCtx({ sections: [] });
    expect(await robotsPlugin.enumerate(ctx)).toEqual([ROBOTS_PATH]);
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.contentType).toBe('text/plain; charset=utf-8');
    expect(result?.body).toContain('User-agent: *');
  });

  it('declares the own sitemap when routes exist', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home' }],
        },
      ],
    });
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.body).toContain('Sitemap: https://tale.dev/sitemap.xml');
  });

  it('omits the own sitemap when no routes exist (platform case)', async () => {
    const ctx = makeCtx({ sections: [] });
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.body).not.toContain('Sitemap: https://tale.dev/sitemap.xml');
  });

  it('appends extra sitemaps from RobotsConfig', async () => {
    const ctx = makeCtx(
      {
        sections: [{ heading: 'Pages', routes: [{ url: '/', title: 'Home' }] }],
      },
      { extraSitemaps: ['https://tale.dev/docs/sitemap.xml'] },
    );
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.body).toContain('Sitemap: https://tale.dev/sitemap.xml');
    expect(result?.body).toContain(
      'Sitemap: https://tale.dev/docs/sitemap.xml',
    );
  });

  it('passes disallow + extraDisallow through to the builder', async () => {
    const ctx = makeCtx(
      {
        sections: [{ heading: 'Pages', routes: [{ url: '/', title: 'Home' }] }],
      },
      { disallow: ['/secret'], extraDisallow: ['/admin'] },
    );
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.body).toContain('Disallow: /secret');
    expect(result?.body).toContain('Disallow: /admin');
  });

  it('honours custom user agent', async () => {
    const ctx = makeCtx({ sections: [] }, { userAgent: 'GPTBot' });
    const result = await robotsPlugin.build(ROBOTS_PATH, ctx);
    expect(result?.body).toContain('User-agent: GPTBot');
  });
});
