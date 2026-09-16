/**
 * Parity contract: the dev `createOnDemandServer` and the prod
 * `createPrecompiledServer` must produce byte-identical responses for
 * the same input. ETags must agree so a CDN can switch between modes
 * without invalidating clients.
 *
 * Both modes share the same plugin set under the hood — this test pins
 * that contract.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileToDisk, type CompileArtifactsParams } from './compile';
import { createOnDemandServer } from './on-demand-server';
import { createPrecompiledServer } from './precompiled-server';

const sample = (): CompileArtifactsParams => ({
  siteUrl: 'https://tale.dev',
  siteTitle: 'Tale',
  siteDescription: 'Sovereign AI.',
  sections: [
    {
      heading: 'Pages',
      routes: [
        { url: '/', title: 'Home', body: '# Home\n\nWelcome.\n' },
        { url: '/pricing', title: 'Pricing', body: '# Pricing\n\nPlans.\n' },
      ],
    },
    {
      heading: 'Locales',
      hideFromIndex: true,
      routes: [{ url: '/de', title: 'Startseite', body: '# Startseite\n' }],
    },
  ],
  optionalPages: [{ title: 'GitHub', url: 'https://github.com/x/y' }],
  robots: { extraSitemaps: ['https://tale.dev/docs/sitemap.xml'] },
});

const URLS = [
  '/llms.txt',
  '/llms-full.txt',
  '/sitemap.xml',
  '/robots.txt',
  '/index.md',
  '/pricing.md',
  '/de.md',
] as const;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tale-seo-parity-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('dev/prod parity', () => {
  it('on-demand and precompiled servers emit identical bodies and ETags', async () => {
    const params = sample();

    await compileToDisk({ ...params, outDir: dir });
    const precompiled = await createPrecompiledServer({ dir });

    const onDemand = createOnDemandServer({
      ...params,
      loadRoutes: async () => ({
        sections: params.sections.slice(),
        optionalPages: params.optionalPages?.slice(),
      }),
    });

    for (const url of URLS) {
      const a = await onDemand.handle(new Request(`https://tale.dev${url}`));
      const b = await precompiled.handle(new Request(`https://tale.dev${url}`));
      expect(a, `on-demand missing ${url}`).not.toBeNull();
      expect(b, `precompiled missing ${url}`).not.toBeNull();
      expect(await a?.text()).toBe(await b?.text());
      expect(a?.headers.get('etag')).toBe(b?.headers.get('etag'));
      expect(a?.headers.get('content-type')).toBe(
        b?.headers.get('content-type'),
      );
    }
  });

  it('serves sitemap.xml as application/xml from both modes', async () => {
    // End-to-end content-type contract: both servers label
    // /sitemap.xml with XML. Locks in the "served as XML" requirement
    // against future refactors that might accidentally drop the charset
    // or downgrade to text/plain.
    const params = sample();
    await compileToDisk({ ...params, outDir: dir });
    const precompiled = await createPrecompiledServer({ dir });
    const onDemand = createOnDemandServer({
      ...params,
      loadRoutes: async () => ({
        sections: params.sections.slice(),
        optionalPages: params.optionalPages?.slice(),
      }),
    });

    for (const server of [onDemand, precompiled]) {
      const response = await server.handle(
        new Request('https://tale.dev/sitemap.xml'),
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get('content-type')).toBe(
        'application/xml; charset=utf-8',
      );
      expect(await response?.text()).toMatch(/^<\?xml /);
    }
  });
});
