import { describe, expect, it, vi } from 'vitest';

import type { BuildContext } from '../runtime/plugin';
import type { ResolvedRoutes } from '../types';
import { LLMS_FULL_TXT_PATH, llmsFullTxtPlugin } from './llms-full-txt';

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

describe('llmsFullTxtPlugin', () => {
  it('matches only /llms-full.txt', () => {
    expect(llmsFullTxtPlugin.match).toBe(LLMS_FULL_TXT_PATH);
  });

  it('returns null when no route carries a body', async () => {
    const ctx = makeCtx({
      sections: [{ heading: 'Pages', routes: [{ url: '/', title: 'Home' }] }],
    });
    const result = await llmsFullTxtPlugin.build(LLMS_FULL_TXT_PATH, ctx);
    expect(result).toBeNull();
  });

  it('concatenates inline route bodies with source attribution', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home', body: '# Home\n\nWelcome.\n' },
            {
              url: '/pricing',
              title: 'Pricing',
              body: '# Pricing\n\nPlans.\n',
            },
          ],
        },
      ],
    });

    const result = await llmsFullTxtPlugin.build(LLMS_FULL_TXT_PATH, ctx);
    expect(result?.contentType).toBe('text/plain; charset=utf-8');
    expect(result?.body).toContain('Source: https://tale.dev/');
    expect(result?.body).toContain('Source: https://tale.dev/pricing');
    expect(result?.body).toContain('Welcome.');
    expect(result?.body).toContain('Plans.');
  });

  it('uses loadBody when the route does not inline a body', async () => {
    const loadBody = vi.fn(async (url: string) => {
      if (url === '/pricing') return '# Pricing\n\nBy the team.\n';
      return null;
    });
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

    const result = await llmsFullTxtPlugin.build(LLMS_FULL_TXT_PATH, ctx);
    expect(result?.body).toContain('By the team.');
    expect(loadBody).toHaveBeenCalledWith('/pricing');
  });

  it('enumerate yields the path when any route can produce a body', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home', body: '# Home\n' }],
        },
      ],
    });
    expect(await llmsFullTxtPlugin.enumerate(ctx)).toEqual([
      LLMS_FULL_TXT_PATH,
    ]);
  });

  it('enumerate yields nothing when no route has a body', async () => {
    const ctx = makeCtx({
      sections: [{ heading: 'Pages', routes: [{ url: '/', title: 'Home' }] }],
    });
    expect(await llmsFullTxtPlugin.enumerate(ctx)).toEqual([]);
  });
});
