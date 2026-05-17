import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MANIFEST_FILE,
  MANIFEST_VERSION,
  readManifest,
  writeManifest,
  type Manifest,
} from './manifest';

const sampleManifest: Manifest = {
  version: MANIFEST_VERSION,
  generatedAt: '2026-05-17T00:00:00Z',
  siteUrl: 'https://tale.dev',
  entries: [
    {
      path: '/llms.txt',
      file: 'llms.txt',
      pluginId: 'llms-txt',
      etag: '"abc1234567890def"',
      contentType: 'text/plain; charset=utf-8',
      cacheControl: 'public, max-age=300',
      byteLength: 42,
    },
  ],
  knownMdPaths: ['/index.md'],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tale-seo-manifest-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeManifest / readManifest', () => {
  it('round-trips a valid manifest', async () => {
    await writeManifest(dir, sampleManifest);
    const read = await readManifest(dir);
    expect(read).toEqual(sampleManifest);
  });

  it('writes pretty-printed JSON to manifest.json', async () => {
    await writeManifest(dir, sampleManifest);
    const raw = await readFile(join(dir, MANIFEST_FILE), 'utf-8');
    expect(raw).toMatch(/\n  "/);
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('rejects manifests with a version mismatch', async () => {
    await writeManifest(dir, { ...sampleManifest, version: 999 });
    await expect(readManifest(dir)).rejects.toThrow(/version mismatch/);
  });

  it('rejects manifests with the wrong shape', async () => {
    await writeFile(
      join(dir, MANIFEST_FILE),
      JSON.stringify({ version: MANIFEST_VERSION, oops: true }),
      'utf-8',
    );
    await expect(readManifest(dir)).rejects.toThrow(/wrong shape/);
  });

  it('throws when the file is missing', async () => {
    await expect(readManifest(dir)).rejects.toThrow();
  });
});
