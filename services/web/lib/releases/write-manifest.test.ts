import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatGeneratedFile,
  isOxfmtClean,
  renderReleasesManifestSource,
  writeReleasesManifest,
} from './write-manifest';

const SAMPLE = [
  {
    tag: 'v1.0.0',
    version: '1.0.0',
    name: null,
    body: '## Notes',
    htmlUrl: 'https://github.com/tale-project/tale/releases/tag/v1.0.0',
    publishedAt: '2026-01-01T00:00:00Z',
  },
] as const;

describe('writeReleasesManifest', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('raw JSON.stringify source fails oxfmt --check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-releases-'));
    dirs.push(dir);
    const path = join(dir, 'releases-manifest.ts');
    writeFileSync(
      path,
      renderReleasesManifestSource(SAMPLE, '2026-01-01T00:00:00Z'),
    );

    expect(await isOxfmtClean(path)).toBe(false);
  });

  it('write + format produces oxfmt-clean single-quoted keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-releases-'));
    dirs.push(dir);
    const path = join(dir, 'releases-manifest.ts');

    await writeReleasesManifest(path, SAMPLE, '2026-01-01T00:00:00Z');

    expect(await isOxfmtClean(path)).toBe(true);

    const source = readFileSync(path, 'utf8');
    expect(source).toContain("tag: 'v1.0.0'");
    expect(source).toContain(
      "RELEASES_FETCHED_AT = '2026-01-01T00:00:00Z' as const",
    );
    expect(source).not.toContain('"tag":');
  });

  it('format: false writes valid content without invoking oxfmt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-releases-'));
    dirs.push(dir);
    const path = join(dir, 'releases-manifest.ts');

    await writeReleasesManifest(path, SAMPLE, '2026-01-01T00:00:00Z', {
      format: false,
    });

    // Unformatted (JSON-quoted keys) but valid TypeScript — what the Docker
    // builder needs, where oxfmt is not part of the contract.
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('"tag": "v1.0.0"');
    expect(await isOxfmtClean(path)).toBe(false);
  });

  it('formatGeneratedFile rejects a missing path', async () => {
    await expect(
      formatGeneratedFile(join(tmpdir(), 'no-such-releases-manifest.ts')),
    ).rejects.toThrow(/oxfmt failed/);
  });
});
