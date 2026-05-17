import { describe, expect, it, vi } from 'vitest';

import type { BuildContext } from '../runtime/plugin';
import type { ResolvedRoutes } from '../types';
import { pageMarkdownPlugin } from './page-markdown';

function makeCtx(
  routes: ResolvedRoutes,
  loadBody?: (url: string) => Promise<string | null>,
): BuildContext {
  return {
    siteUrl: 'https://tale.dev',
    siteTitle: 'Tale',
    siteDescription: 'Sovereign AI.',
    routes: async () => routes,
    body: async (url) => {
      for (const section of routes.sections) {
        for (const route of section.routes) {
          if (route.url === url && typeof route.body === 'string')
            return route.body;
        }
      }
      return loadBody ? loadBody(url) : null;
    },
  };
}

describe('pageMarkdownPlugin', () => {
  it('matches any .md pathname', () => {
    const matcher = pageMarkdownPlugin.match;
    if (typeof matcher !== 'function') {
      throw new Error('Expected page-markdown match to be a predicate');
    }
    expect(matcher('/pricing.md')).toBe(true);
    expect(matcher('/de/legal/imprint.md')).toBe(true);
    expect(matcher('/pricing')).toBe(false);
    expect(matcher('/llms.txt')).toBe(false);
  });

  it('keys the cache by pathname so each page caches independently', () => {
    expect(pageMarkdownPlugin.cacheKey('/pricing.md')).toBe('/pricing.md');
    expect(pageMarkdownPlugin.cacheKey('/index.md')).toBe('/index.md');
  });

  it('returns null for unknown pathnames', async () => {
    const ctx = makeCtx({
      sections: [{ heading: 'Pages', routes: [{ url: '/', title: 'Home' }] }],
    });
    expect(await pageMarkdownPlugin.build('/missing.md', ctx)).toBeNull();
  });

  it('returns null when route exists but has no body', async () => {
    const ctx = makeCtx({
      sections: [
        { heading: 'Pages', routes: [{ url: '/pricing', title: 'Pricing' }] },
      ],
    });
    expect(await pageMarkdownPlugin.build('/pricing.md', ctx)).toBeNull();
  });

  it('emits frontmatter and rewrites relative links to absolute', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            {
              url: '/pricing',
              title: 'Pricing',
              description: 'Plans.',
              body: '# Pricing\n\nSee [contact](/contact).\n',
            },
          ],
        },
      ],
    });
    const result = await pageMarkdownPlugin.build('/pricing.md', ctx);
    expect(result?.contentType).toBe('text/markdown; charset=utf-8');
    expect(result?.body).toContain('title: "Pricing"');
    expect(result?.body).toContain('description: "Plans."');
    expect(result?.body).toContain('[contact](https://tale.dev/contact)');
  });

  it('renders / as /index.md', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home', body: '# Home\n' }],
        },
      ],
    });
    const result = await pageMarkdownPlugin.build('/index.md', ctx);
    expect(result?.body).toContain('title: "Home"');
  });

  it('enumerates every body-bearing route', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home', body: '# Home\n' },
            { url: '/pricing', title: 'Pricing', body: '# Pricing\n' },
            { url: '/no-body', title: 'No body' },
          ],
        },
      ],
    });
    const paths = [...(await pageMarkdownPlugin.enumerate(ctx))].sort();
    expect(paths).toEqual(['/index.md', '/pricing.md']);
  });

  it('uses loadBody for routes without inline content', async () => {
    const loadBody = vi.fn(async (url: string) =>
      url === '/pricing' ? '# Pricing\n' : null,
    );
    const ctx = makeCtx(
      {
        sections: [
          {
            heading: 'Pages',
            routes: [{ url: '/pricing', title: 'Pricing' }],
          },
        ],
      },
      loadBody,
    );
    const result = await pageMarkdownPlugin.build('/pricing.md', ctx);
    expect(result?.body).toContain('# Pricing');
    expect(loadBody).toHaveBeenCalledWith('/pricing');
  });
});
