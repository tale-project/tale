/**
 * Performance + cache-shape contracts for the on-demand server.
 * Locks in:
 *   - `loadRoutes` runs at most once per request and is cached across requests
 *   - `loadBody` per route is called at most once per request lifecycle
 *   - 304 short-circuits don't hit the loaders
 *   - negative cache prevents re-enumeration on repeated unknown probes
 */

import { describe, expect, it, vi, type Mock } from 'vitest';

import type { ArtifactSection, OptionalPage } from '../types';
import {
  createOnDemandServer,
  type ArtifactsServerParams,
} from './on-demand-server';

type LoadRoutesFn = () => Promise<{
  sections: ArtifactSection[];
  optionalPages?: OptionalPage[];
}>;
type LoadBodyFn = (url: string) => Promise<string | null>;

interface FakeParams {
  loadRoutes: Mock<LoadRoutesFn>;
  loadBody: Mock<LoadBodyFn>;
  params: ArtifactsServerParams;
}

function paramsWithFakes(): FakeParams {
  const loadRoutes = vi.fn<LoadRoutesFn>(async () => ({
    sections: [
      {
        heading: 'Pages',
        routes: [
          { url: '/', title: 'Home' },
          { url: '/pricing', title: 'Pricing' },
          { url: '/contact', title: 'Contact' },
        ],
      },
    ],
  }));
  const loadBody = vi.fn<LoadBodyFn>(
    async (url) => `# ${url}\n\nBody for ${url}.\n`,
  );
  return {
    loadRoutes,
    loadBody,
    params: {
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      loadRoutes,
      loadBody,
    },
  };
}

describe('on-demand server: performance + cache shape', () => {
  it('keeps concurrent development requests fresh when caching is disabled', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer({ ...fakes.params, cache: false });
    await Promise.all(
      Array.from({ length: 5 }, () =>
        server.handle(new Request('https://tale.dev/llms-full.txt')),
      ),
    );
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(5);
    expect(fakes.loadBody).toHaveBeenCalledTimes(15);
  });

  it('coalesces a cold burst into one build and returns independent bodies', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        server.handle(new Request('https://tale.dev/llms-full.txt')),
      ),
    );
    const bodies = await Promise.all(
      responses.map((response) => response?.text()),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('Body for /pricing.');
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(1);
    expect(fakes.loadBody).toHaveBeenCalledTimes(3);
  });

  it('enumerates routes once across different artifacts and unknown probes', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);
    await Promise.all(
      [
        '/llms.txt',
        '/sitemap.xml',
        '/pricing.md',
        '/missing-a.md',
        '/missing-b.md',
      ].map((pathname) =>
        server.handle(new Request(`https://tale.dev${pathname}`)),
      ),
    );
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(1);
    server.invalidate();
    await server.handle(new Request('https://tale.dev/llms.txt'));
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(2);
  });

  it('retries a failed build without retaining its rejected route lookup', async () => {
    const fakes = paramsWithFakes();
    fakes.loadRoutes.mockRejectedValueOnce(new Error('temporary read failure'));
    const server = createOnDemandServer(fakes.params);
    await expect(
      server.handle(new Request('https://tale.dev/llms.txt')),
    ).rejects.toThrow('temporary read failure');
    expect(
      await (
        await server.handle(new Request('https://tale.dev/llms.txt'))
      )?.text(),
    ).toContain('# Tale');
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(2);
  });

  it('does not let a build finishing after invalidation replace fresh content', async () => {
    const fakes = paramsWithFakes();
    const oldRoutes =
      Promise.withResolvers<Awaited<ReturnType<LoadRoutesFn>>>();
    fakes.loadRoutes.mockReturnValueOnce(oldRoutes.promise);
    const server = createOnDemandServer(fakes.params);
    const oldRequest = server.handle(new Request('https://tale.dev/llms.txt'));
    server.invalidate();
    const fresh = await server.handle(new Request('https://tale.dev/llms.txt'));
    const freshBody = await fresh?.text();
    oldRoutes.resolve({ sections: [{ heading: 'Obsolete', routes: [] }] });
    await oldRequest;
    const cached = await server.handle(
      new Request('https://tale.dev/llms.txt'),
    );
    expect(await cached?.text()).toBe(freshBody);
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(2);
  });

  it('does not retain an obsolete missing-page result after invalidation', async () => {
    const fakes = paramsWithFakes();
    const oldRoutes =
      Promise.withResolvers<Awaited<ReturnType<LoadRoutesFn>>>();
    fakes.loadRoutes.mockReturnValueOnce(oldRoutes.promise);
    const server = createOnDemandServer(fakes.params);
    const oldRequest = server.handle(
      new Request('https://tale.dev/pricing.md'),
    );
    server.invalidate();
    expect(
      (await server.handle(new Request('https://tale.dev/pricing.md')))?.status,
    ).toBe(200);
    oldRoutes.resolve({ sections: [] });
    expect(await oldRequest).toBeNull();
    expect(
      (await server.handle(new Request('https://tale.dev/pricing.md')))?.status,
    ).toBe(200);
  });

  it('llms-full.txt calls loadBody at most once per route', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);
    await server.handle(new Request('https://tale.dev/llms-full.txt'));
    expect(fakes.loadBody).toHaveBeenCalledTimes(3);
    const calledUrls = fakes.loadBody.mock.calls
      .map((c) => c[0])
      .slice()
      .sort((a, b) => a.localeCompare(b));
    expect(calledUrls).toEqual(['/', '/contact', '/pricing']);
  });

  it('loadRoutes runs once even when multiple artifacts share a request', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);
    await server.handle(new Request('https://tale.dev/llms-full.txt'));
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(1);
  });

  it('cached requests do not re-invoke loadRoutes or loadBody', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);
    await server.handle(new Request('https://tale.dev/llms-full.txt'));
    fakes.loadRoutes.mockClear();
    fakes.loadBody.mockClear();
    await server.handle(new Request('https://tale.dev/llms-full.txt'));
    expect(fakes.loadRoutes).not.toHaveBeenCalled();
    expect(fakes.loadBody).not.toHaveBeenCalled();
  });

  it('304 short-circuit returns no body and no cache-control mismatch', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);

    const first = await server.handle(new Request('https://tale.dev/llms.txt'));
    const etag = first?.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"[0-9a-f]+"$/);

    const second = await server.handle(
      new Request('https://tale.dev/llms.txt', {
        headers: { 'if-none-match': etag },
      }),
    );
    expect(second?.status).toBe(304);
    expect(second?.body).toBeNull();
    expect(second?.headers.get('cache-control')).toBe(
      first?.headers.get('cache-control'),
    );
  });

  it('negative cache prevents re-enumeration on repeated unknown .md probes', async () => {
    const fakes = paramsWithFakes();
    const server = createOnDemandServer(fakes.params);

    await server.handle(new Request('https://tale.dev/missing.md'));
    await server.handle(new Request('https://tale.dev/missing.md'));
    await server.handle(new Request('https://tale.dev/missing.md'));

    // loadRoutes runs once for the first probe; afterwards the negative
    // cache short-circuits without touching the loader.
    expect(fakes.loadRoutes).toHaveBeenCalledTimes(1);
  });
});
