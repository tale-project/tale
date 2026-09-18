import { describe, expect, it } from 'vitest';

import type { BuildContext } from '../runtime/plugin';
import type { ResolvedRoutes } from '../types';
import { LLMS_TXT_PATH, llmsTxtPlugin } from './llms-txt';

function makeCtx(routes: ResolvedRoutes): BuildContext {
  return {
    siteUrl: 'https://tale.dev',
    siteTitle: 'Tale',
    siteDescription: 'Sovereign AI.',
    routes: async () => routes,
    body: async () => null,
  };
}

describe('llmsTxtPlugin', () => {
  it('matches only /llms.txt', () => {
    expect(llmsTxtPlugin.match).toBe(LLMS_TXT_PATH);
  });

  it('always uses the static cache key', () => {
    expect(llmsTxtPlugin.cacheKey('/llms.txt')).toBe('static');
    expect(llmsTxtPlugin.cacheKey('/foo')).toBe('static');
  });

  it('enumerates a single path', async () => {
    const ctx = makeCtx({ sections: [] });
    expect(await llmsTxtPlugin.enumerate(ctx)).toEqual([LLMS_TXT_PATH]);
  });

  it('emits a title, blockquote, and per-section page list', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home', description: 'Welcome.' },
            { url: '/pricing', title: 'Pricing', description: 'Plans.' },
          ],
        },
      ],
    });

    const result = await llmsTxtPlugin.build(LLMS_TXT_PATH, ctx);
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe('text/plain; charset=utf-8');
    expect(result?.body).toContain('# Tale');
    expect(result?.body).toContain('> Sovereign AI.');
    expect(result?.body).toContain('## Pages');
    expect(result?.body).toContain('https://tale.dev/index.md');
    expect(result?.body).toContain('https://tale.dev/pricing.md');
    expect(result?.body).toContain(': Welcome.');
  });

  it('omits sections marked hideFromIndex', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home' }],
        },
        {
          heading: 'Locales',
          hideFromIndex: true,
          routes: [{ url: '/de', title: 'Startseite' }],
        },
      ],
    });

    const result = await llmsTxtPlugin.build(LLMS_TXT_PATH, ctx);
    expect(result?.body).toContain('## Pages');
    expect(result?.body).not.toContain('## Locales');
    expect(result?.body).not.toContain('Startseite');
  });

  it('includes optional pages under a `## Optional` section', async () => {
    const ctx = makeCtx({
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home' }],
        },
      ],
      optionalPages: [{ title: 'GitHub', url: 'https://github.com/x/y' }],
    });

    const result = await llmsTxtPlugin.build(LLMS_TXT_PATH, ctx);
    expect(result?.body).toContain('## Optional');
    expect(result?.body).toContain('[GitHub](https://github.com/x/y)');
  });

  it('trims trailing slashes from siteUrl so links never double-slash', async () => {
    const ctx: BuildContext = {
      ...makeCtx({
        sections: [
          {
            heading: 'Pages',
            routes: [{ url: '/pricing', title: 'Pricing' }],
          },
        ],
      }),
      siteUrl: 'https://tale.dev/',
    };

    const result = await llmsTxtPlugin.build(LLMS_TXT_PATH, ctx);
    expect(result?.body).toContain('https://tale.dev/pricing.md');
    expect(result?.body).not.toContain('tale.dev//');
  });
});
