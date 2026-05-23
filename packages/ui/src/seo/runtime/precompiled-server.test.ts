import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MANIFEST_VERSION, writeManifest, type Manifest } from './manifest';
import {
  createPrecompiledServer,
  createPrecompiledServerFromManifest,
} from './precompiled-server';

const fakeBodies = {
  '/llms.txt': '# Tale\n',
  '/robots.txt': 'User-agent: *\nAllow: /\n',
  '/pricing.md': '---\ntitle: "Pricing"\n---\n\n# Pricing\n',
};

function manifestFor(): Manifest {
  return {
    version: MANIFEST_VERSION,
    generatedAt: '2026-05-17T00:00:00Z',
    siteUrl: 'https://tale.dev',
    entries: [
      {
        path: '/llms.txt',
        file: 'llms.txt',
        pluginId: 'llms-txt',
        etag: '"e1"',
        contentType: 'text/plain; charset=utf-8',
        cacheControl: 'public, max-age=300',
        byteLength: Buffer.byteLength(fakeBodies['/llms.txt']),
      },
      {
        path: '/robots.txt',
        file: 'robots.txt',
        pluginId: 'robots',
        etag: '"e2"',
        contentType: 'text/plain; charset=utf-8',
        cacheControl: 'public, max-age=300',
        byteLength: Buffer.byteLength(fakeBodies['/robots.txt']),
      },
      {
        path: '/pricing.md',
        file: 'pricing.md',
        pluginId: 'page-markdown',
        etag: '"e3"',
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'public, max-age=300',
        byteLength: Buffer.byteLength(fakeBodies['/pricing.md']),
      },
    ],
    knownMdPaths: ['/pricing.md'],
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tale-seo-precomp-'));
  await writeFile(join(dir, 'llms.txt'), fakeBodies['/llms.txt'], 'utf-8');
  await writeFile(join(dir, 'robots.txt'), fakeBodies['/robots.txt'], 'utf-8');
  await writeFile(join(dir, 'pricing.md'), fakeBodies['/pricing.md'], 'utf-8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createPrecompiledServer', () => {
  it('serves /llms.txt from disk with the manifest content-type and ETag', async () => {
    await writeManifest(dir, manifestFor());
    const server = await createPrecompiledServer({ dir });

    const response = await server.handle(
      new Request('https://tale.dev/llms.txt'),
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(response?.headers.get('etag')).toBe('"e1"');
    expect(await response?.text()).toBe('# Tale\n');
  });

  it('honours If-None-Match with a 304', async () => {
    await writeManifest(dir, manifestFor());
    const server = await createPrecompiledServer({ dir });

    const response = await server.handle(
      new Request('https://tale.dev/robots.txt', {
        headers: { 'if-none-match': '"e2"' },
      }),
    );
    expect(response?.status).toBe(304);
    expect(response?.headers.get('etag')).toBe('"e2"');
  });

  it('returns null for unknown paths', async () => {
    await writeManifest(dir, manifestFor());
    const server = await createPrecompiledServer({ dir });
    expect(
      await server.handle(new Request('https://tale.dev/missing')),
    ).toBeNull();
  });

  it('short-circuits unknown .md paths via knownMdPaths', async () => {
    await writeManifest(dir, manifestFor());
    const server = await createPrecompiledServer({ dir });
    expect(
      await server.handle(new Request('https://tale.dev/unknown.md')),
    ).toBeNull();
  });

  it('serves /sitemap.xml with application/xml content-type', async () => {
    await writeManifest(dir, manifestFor());
    // Add a sitemap to the existing fixture so we can assert it through
    // the precompiled path. We rewrite the manifest + drop the file
    // alongside the others.
    const sitemapBody =
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
    await writeFile(join(dir, 'sitemap.xml'), sitemapBody, 'utf-8');
    await writeManifest(dir, {
      ...manifestFor(),
      entries: [
        ...manifestFor().entries,
        {
          path: '/sitemap.xml',
          file: 'sitemap.xml',
          pluginId: 'sitemap',
          etag: '"sm"',
          contentType: 'application/xml; charset=utf-8',
          cacheControl: 'public, max-age=300',
          byteLength: Buffer.byteLength(sitemapBody),
        },
      ],
    });
    const server = await createPrecompiledServer({ dir });
    const response = await server.handle(
      new Request('https://tale.dev/sitemap.xml'),
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(await response?.text()).toContain('<urlset');
  });

  it('caches file bodies in memory after first read', async () => {
    await writeManifest(dir, manifestFor());
    const server = await createPrecompiledServer({ dir });

    const first = await server.handle(new Request('https://tale.dev/llms.txt'));
    expect(await first?.text()).toBe('# Tale\n');

    // Overwrite the file on disk — a cached server must keep returning the
    // cached body until invalidate() runs.
    await writeFile(join(dir, 'llms.txt'), '# Changed\n', 'utf-8');
    const second = await server.handle(
      new Request('https://tale.dev/llms.txt'),
    );
    expect(await second?.text()).toBe('# Tale\n');

    server.invalidate();
    const third = await server.handle(new Request('https://tale.dev/llms.txt'));
    expect(await third?.text()).toBe('# Changed\n');
  });
});

describe('createPrecompiledServerFromManifest', () => {
  it('works without touching the filesystem for the manifest', async () => {
    const server = createPrecompiledServerFromManifest({
      dir,
      manifest: manifestFor(),
    });
    const response = await server.handle(
      new Request('https://tale.dev/pricing.md'),
    );
    expect(response?.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8',
    );
    expect(await response?.text()).toContain('title: "Pricing"');
  });
});
