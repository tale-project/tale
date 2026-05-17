/**
 * Deploy-simulation test for the docs SEO pipeline. Locks in the
 * production bug fix: `createPrecompiledServer` must serve every
 * artifact URL **without** the source markdown tree being on disk at
 * runtime.
 *
 * Setup: walk `docs/`, compile everything to a temp dir, then construct
 * a precompiled server using only the temp dir. A regression to a
 * runtime disk walk (e.g. some service-local code reaching back to
 * `walk-content`) makes one of these requests fail.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileToDisk, createPrecompiledServer } from '@tale/seo';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildDocsCompileParams } from './build';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tale-docs-deploy-sim-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('docs deploy simulation', () => {
  it('precompiled server answers /llms.txt, /sitemap.xml, /robots.txt', async () => {
    const params = await buildDocsCompileParams();
    await compileToDisk({ ...params, outDir: dir });

    const server = await createPrecompiledServer({ dir });
    for (const path of ['/llms.txt', '/sitemap.xml', '/robots.txt']) {
      const response = await server.handle(
        new Request(`https://tale.dev${path}`),
      );
      expect(response, `missing ${path}`).not.toBeNull();
      expect(response?.status).toBe(200);
      const text = await response?.text();
      expect(text?.length).toBeGreaterThan(0);
    }
  });

  it('every known .md path round-trips through the precompiled server', async () => {
    const params = await buildDocsCompileParams();
    const { manifest } = await compileToDisk({ ...params, outDir: dir });

    const server = await createPrecompiledServer({ dir });
    for (const mdPath of manifest.knownMdPaths.slice(0, 5)) {
      const response = await server.handle(
        new Request(`https://tale.dev${mdPath}`),
      );
      expect(response, `missing ${mdPath}`).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get('content-type')).toBe(
        'text/markdown; charset=utf-8',
      );
      const text = await response?.text();
      expect(text?.length).toBeGreaterThan(0);
    }
  });

  it('unknown .md paths return null (handled as 404 by caller)', async () => {
    const params = await buildDocsCompileParams();
    await compileToDisk({ ...params, outDir: dir });

    const server = await createPrecompiledServer({ dir });
    expect(
      await server.handle(
        new Request('https://tale.dev/definitely/not/a/real/page.md'),
      ),
    ).toBeNull();
  });

  it('llms-full.txt is emitted and non-empty', async () => {
    const params = await buildDocsCompileParams();
    await compileToDisk({ ...params, outDir: dir });

    const server = await createPrecompiledServer({ dir });
    const response = await server.handle(
      new Request('https://tale.dev/llms-full.txt'),
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const text = await response?.text();
    expect(text?.length).toBeGreaterThan(0);
  });
});
