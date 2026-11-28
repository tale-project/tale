import { describe, expect, it, vi } from 'vitest';

import {
  createArtifactsServer,
  type ArtifactsServerParams,
} from './on-demand-server';

function baseParams(): ArtifactsServerParams {
  return {
    siteUrl: 'https://tale.dev',
    siteTitle: 'Tale',
    siteDescription: 'Sovereign AI.',
    loadRoutes: async () => ({
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home', description: 'Welcome.' },
            { url: '/pricing', title: 'Pricing', description: 'Plans.' },
          ],
        },
      ],
    }),
    loadBody: async (url) => {
      if (url === '/') return '# Home\n\nWelcome.\n';
      if (url === '/pricing') return '# Pricing\n\nPlans.\n';
      return null;
    },
  };
}

function get(pathname: string): Request {
  return new Request(`https://tale.dev${pathname}`);
}

describe('createArtifactsServer', () => {
  it('serves /llms.txt with the page list', async () => {
    const server = createArtifactsServer(baseParams());
    const response = await server.handle(get('/llms.txt'));
    expect(response).not.toBeNull();
    expect(response?.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    const body = await response?.text();
    expect(body).toContain('# Tale');
    expect(body).toContain('https://tale.dev/pricing.md');
  });

  it('serves /sitemap.xml with the right content type', async () => {
    const server = createArtifactsServer(baseParams());
    const response = await server.handle(get('/sitemap.xml'));
    expect(response?.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(await response?.text()).toContain('<urlset');
  });

  it('serves /robots.txt with the canonical sitemap URL', async () => {
    const server = createArtifactsServer(baseParams());
    const response = await server.handle(get('/robots.txt'));
    expect(await response?.text()).toContain(
      'Sitemap: https://tale.dev/sitemap.xml',
    );
  });

  it('serves /llms-full.txt with bodies from loadBody', async () => {
    const server = createArtifactsServer(baseParams());
    const response = await server.handle(get('/llms-full.txt'));
    const body = (await response?.text()) ?? '';
    expect(body).toContain('Source: https://tale.dev/');
    expect(body).toContain('Welcome.');
    expect(body).toContain('Plans.');
  });

  it('serves /<route>.md by calling loadBody lazily for that route only', async () => {
    const loadBody = vi.fn(baseParams().loadBody);
    const server = createArtifactsServer({ ...baseParams(), loadBody });

    const response = await server.handle(get('/pricing.md'));
    expect(response?.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    const body = (await response?.text()) ?? '';
    expect(body).toContain('title: "Pricing"');
    expect(body).toContain('Plans.');
    expect(loadBody).toHaveBeenCalledWith('/pricing');
    expect(loadBody).not.toHaveBeenCalledWith('/');
  });

  it('returns null for unknown .md routes', async () => {
    const server = createArtifactsServer(baseParams());
    expect(await server.handle(get('/missing.md'))).toBeNull();
  });

  it('returns null for non-artifact pathnames', async () => {
    const server = createArtifactsServer(baseParams());
    expect(await server.handle(get('/pricing'))).toBeNull();
    expect(await server.handle(get('/index.html'))).toBeNull();
  });

  it('honours If-None-Match with a 304', async () => {
    const server = createArtifactsServer(baseParams());
    const first = await server.handle(get('/llms.txt'));
    const etag = first?.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"[0-9a-f]+"$/);

    const second = await server.handle(
      new Request('https://tale.dev/llms.txt', {
        headers: { 'if-none-match': etag },
      }),
    );
    expect(second?.status).toBe(304);
  });

  it('caches across calls when cache is enabled', async () => {
    const loadRoutes = vi.fn(baseParams().loadRoutes);
    const server = createArtifactsServer({ ...baseParams(), loadRoutes });

    await server.handle(get('/llms.txt'));
    await server.handle(get('/llms.txt'));
    expect(loadRoutes).toHaveBeenCalledTimes(1);
  });

  it('rebuilds on every call when cache is disabled', async () => {
    const loadRoutes = vi.fn(baseParams().loadRoutes);
    const server = createArtifactsServer({
      ...baseParams(),
      loadRoutes,
      cache: false,
    });

    await server.handle(get('/llms.txt'));
    await server.handle(get('/llms.txt'));
    expect(loadRoutes).toHaveBeenCalledTimes(2);
  });

  it('invalidate() forces a refresh on the next call', async () => {
    const loadRoutes = vi.fn(baseParams().loadRoutes);
    const server = createArtifactsServer({ ...baseParams(), loadRoutes });

    await server.handle(get('/llms.txt'));
    server.invalidate();
    await server.handle(get('/llms.txt'));
    expect(loadRoutes).toHaveBeenCalledTimes(2);
  });
});
