import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeCanonicalUrl } from './canonical-url';
import {
  compileToDisk,
  compileToMemory,
  type CompileArtifactsParams,
} from './compile';
import { respondWithEtag } from './etag';
import { readManifest, writeManifest } from './manifest';
import { createOnDemandServer } from './on-demand-server';
import type { ArtifactPlugin } from './plugin';
import { createPrecompiledServer } from './precompiled-server';

const params: CompileArtifactsParams = {
  siteUrl: 'https://docs.example.com/guides/',
  siteTitle: 'Documentation',
  siteDescription: 'Product guides.',
  sections: [
    {
      heading: 'Pages',
      routes: [
        { url: '/', title: 'Home', body: '# Home\n' },
        { url: '/de/setup', title: 'Setup', body: '# Setup\n' },
        { url: '/fr/caf%C3%A9', title: 'Café', body: '# Café\n' },
      ],
    },
  ],
};

const expectedCanonicals = [
  ['/index.md', 'https://docs.example.com/guides/'],
  ['/de/setup.md', 'https://docs.example.com/guides/de/setup'],
  ['/fr/caf%C3%A9.md', 'https://docs.example.com/guides/fr/caf%C3%A9'],
] as const;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tale-seo-canonical-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function onDemand(plugins?: readonly ArtifactPlugin[]) {
  return createOnDemandServer({
    ...params,
    loadRoutes: async () => ({ sections: [...params.sections] }),
    ...(plugins ? { plugins } : {}),
  });
}

describe('per-page Markdown canonical HTTP headers', () => {
  it('preserves canonical identity through compilation, caching and conditional requests', async () => {
    const { manifest } = await compileToDisk({ ...params, outDir: dir });
    const servers = [onDemand(), await createPrecompiledServer({ dir })];

    for (const [path, canonicalUrl] of expectedCanonicals) {
      expect(
        manifest.entries.find((entry) => entry.path === path)?.canonicalUrl,
      ).toBe(canonicalUrl);
      const bodies: string[] = [];
      const etags: (string | null)[] = [];
      for (const server of servers) {
        // The incoming host, query and forwarded headers never determine identity.
        const requestUrl = `https://preview.invalid${path}?campaign=test`;
        const request = new Request(requestUrl, {
          headers: { 'x-forwarded-host': 'untrusted.invalid' },
        });
        const first = await server.handle(request);
        expect(first?.status).toBe(200);
        expect(first?.headers.get('link')).toBe(
          `<${canonicalUrl}>; rel="canonical"`,
        );
        expect(first?.headers.get('content-type')).toBe(
          'text/markdown; charset=utf-8',
        );
        bodies.push(await first!.text());
        etags.push(first!.headers.get('etag'));

        const cached = await server.handle(request);
        expect(cached?.headers.get('link')).toBe(first?.headers.get('link'));
        expect(await cached!.text()).toBe(bodies.at(-1));

        const conditional = await server.handle(
          new Request(requestUrl, {
            headers: { 'if-none-match': first!.headers.get('etag')! },
          }),
        );
        expect(conditional?.status).toBe(304);
        expect(conditional?.body).toBeNull();
        expect(conditional?.headers.get('link')).toBe(
          first?.headers.get('link'),
        );
        expect(conditional?.headers.get('etag')).toBe(
          first?.headers.get('etag'),
        );
        expect(conditional?.headers.get('cache-control')).toBe(
          first?.headers.get('cache-control'),
        );
      }
      expect(bodies[0]).toBe(bodies[1]);
      expect(etags[0]).toBe(etags[1]);
    }
  });

  it('does not invent a canonical for aggregate artifacts or unknown pages', async () => {
    await compileToDisk({ ...params, outDir: dir });
    for (const server of [onDemand(), await createPrecompiledServer({ dir })]) {
      for (const path of [
        '/llms.txt',
        '/llms-full.txt',
        '/robots.txt',
        '/sitemap.xml',
      ]) {
        const response = await server.handle(
          new Request(`https://preview.invalid${path}`),
        );
        expect(response?.status).toBe(200);
        expect(response?.headers.get('link')).toBeNull();
      }
      expect(
        await server.handle(new Request('https://preview.invalid/missing.md')),
      ).toBeNull();
    }
  });

  it('loads legacy v1 manifests without canonical metadata', async () => {
    const { manifest } = await compileToDisk({ ...params, outDir: dir });
    for (const entry of manifest.entries) delete entry.canonicalUrl;
    await writeManifest(dir, manifest);
    expect((await readManifest(dir)).version).toBe(1);
    const server = await createPrecompiledServer({ dir });
    const response = await server.handle(
      new Request('https://preview.invalid/index.md'),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('link')).toBeNull();
    expect(await response!.text()).toContain('# Home');
  });
});

const invalidCanonicals = [
  '/relative',
  '//example.com/path',
  'http:example.com/path',
  'javascript:alert(1)',
  'ftp://example.com/path',
  'https://user:password@example.com/path',
  'https://example.com/path#section',
  'https://example.com/path#',
  ' https://example.com/path',
  'https://example.com/path ',
  'https://example.com/path\r\nX-Injected: true',
  'https://example.com/\tpath',
  'https://example.com/\u0000path',
];

describe('canonical metadata validation', () => {
  it.each(invalidCanonicals)(
    'refuses unsafe or noncanonical metadata %j',
    (canonicalUrl) => {
      expect(() => normalizeCanonicalUrl(canonicalUrl)).toThrow(
        /canonical URL/,
      );
      expect(() =>
        respondWithEtag(new Request('https://example.com/page.md'), {
          body: 'body',
          etag: '"body"',
          contentType: 'text/markdown',
          cacheControl: 'public',
          canonicalUrl,
        }),
      ).toThrow(/canonical URL/);
    },
  );

  it('serializes Unicode, spaces and delimiters before writing an HTTP header', () => {
    const response = respondWithEtag(
      new Request('https://example.com/page.md'),
      {
        body: 'body',
        etag: '"body"',
        contentType: 'text/markdown',
        cacheControl: 'public',
        canonicalUrl: 'https://münich.example/café guide<part>?q="value"',
      },
    );
    expect(response.headers.get('link')).toBe(
      '<https://xn--mnich-kva.example/caf%C3%A9%20guide%3Cpart%3E?q=%22value%22>; rel="canonical"',
    );
    expect(normalizeCanonicalUrl('http://localhost:3002/guide')).toBe(
      'http://localhost:3002/guide',
    );
  });

  it.each([null, 42, ...invalidCanonicals])(
    'rejects malformed manifest canonical metadata %j',
    async (canonicalUrl) => {
      const { manifest } = await compileToDisk({ ...params, outDir: dir });
      const entry = manifest.entries.find((item) => item.path === '/index.md')!;
      Object.assign(entry, { canonicalUrl });
      await writeManifest(dir, manifest);
      await expect(readManifest(dir)).rejects.toThrow(/wrong shape/);
    },
  );

  it('rejects invalid custom plugin metadata in both runtime and compilation', async () => {
    const plugin: ArtifactPlugin = {
      id: 'invalid-canonical',
      match: '/bad.md',
      cacheKey: () => 'static',
      enumerate: async () => ['/bad.md'],
      build: async () => ({
        body: 'body',
        contentType: 'text/markdown',
        cacheControl: 'public',
        canonicalUrl: '/relative',
      }),
    };
    await expect(
      compileToMemory({ ...params, plugins: [plugin] }),
    ).rejects.toThrow(/canonical URL/);
    await expect(
      onDemand([plugin]).handle(new Request('https://preview.invalid/bad.md')),
    ).rejects.toThrow(/canonical URL/);
  });
});
