import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compileArtifacts,
  compileToDisk,
  compileToMemory,
  type CompileArtifactsParams,
} from './compile';
import { etagOf } from './etag';
import { MANIFEST_FILE, readManifest } from './manifest';

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

describe('compileToMemory', () => {
  it('resolves bodies through loadBody when not inlined on the route', async () => {
    const loadBody = vi.fn(async (url: string) =>
      url === '/pricing' ? '# Pricing\n\nPlans.\n' : null,
    );
    const result = await compileToMemory({
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/pricing', title: 'Pricing' }],
        },
      ],
      loadBody,
    });

    expect(result.has('/llms.txt')).toBe(true);
    expect(result.has('/pricing.md')).toBe(true);
    expect(result.get('/pricing.md')?.body).toContain('Plans.');
    expect(loadBody).toHaveBeenCalledWith('/pricing');
  });

  it('memoises loadBody — each route URL fetched once across plugins', async () => {
    const loadBody = vi.fn(async (url: string) =>
      url === '/pricing' ? '# Pricing\n' : null,
    );
    await compileToMemory({
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/pricing', title: 'Pricing' }],
        },
      ],
      loadBody,
    });
    // /pricing body feeds both /llms-full.txt and /pricing.md — but only
    // one loadBody call must hit the loader.
    expect(loadBody).toHaveBeenCalledTimes(1);
  });
});

describe('compileToDisk', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tale-seo-compile-disk-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes every artifact + manifest.json', async () => {
    const result = await compileToDisk({
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          routes: [
            { url: '/', title: 'Home', body: '# Home\n' },
            { url: '/pricing', title: 'Pricing', body: '# Pricing\n' },
          ],
        },
      ],
      outDir: dir,
    });

    expect(result.emittedFiles).toContain('llms.txt');
    expect(result.emittedFiles).toContain('robots.txt');
    expect(result.emittedFiles).toContain('sitemap.xml');
    expect(result.emittedFiles).toContain('index.md');
    expect(result.emittedFiles).toContain('pricing.md');

    const manifest = await readManifest(dir);
    expect(manifest.entries.map((e) => e.path).sort()).toEqual([
      '/index.md',
      '/llms-full.txt',
      '/llms.txt',
      '/pricing.md',
      '/robots.txt',
      '/sitemap.xml',
    ]);
    expect(manifest.knownMdPaths.sort()).toEqual(['/index.md', '/pricing.md']);
    expect(manifest.siteUrl).toBe('https://tale.dev');
  });

  it('precomputed ETags match sha256 of the emitted bytes', async () => {
    await compileToDisk({
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home', body: '# Home\n' }],
        },
      ],
      outDir: dir,
    });

    const manifest = await readManifest(dir);
    for (const entry of manifest.entries) {
      const onDisk = await readFile(join(dir, entry.file), 'utf-8');
      expect(entry.etag).toBe(etagOf(onDisk));
      expect(entry.byteLength).toBe(Buffer.byteLength(onDisk));
    }
  });

  it('throws when the compiled set is empty (no llms.txt/robots.txt)', async () => {
    // sectionless input still emits llms.txt + robots.txt, so an empty
    // set requires explicit plugin override.
    await expect(
      compileToDisk({
        siteUrl: 'https://tale.dev',
        siteTitle: 'Tale',
        siteDescription: 'Sovereign AI.',
        sections: [],
        outDir: dir,
        plugins: [],
      }),
    ).rejects.toThrow(/empty artifact set/);
  });

  it('uses an existing manifest.json file in the output directory', async () => {
    await compileToDisk({
      siteUrl: 'https://tale.dev',
      siteTitle: 'Tale',
      siteDescription: 'Sovereign AI.',
      sections: [
        {
          heading: 'Pages',
          routes: [{ url: '/', title: 'Home', body: '# Home\n' }],
        },
      ],
      outDir: dir,
    });
    const raw = await readFile(join(dir, MANIFEST_FILE), 'utf-8');
    expect(raw).toMatch(/"version":\s*1/);
  });
});
