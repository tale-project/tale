import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearProviderFilesCacheForTest,
  computeProvidersFingerprint,
  getCachedProviders,
  setCachedProviders,
} from './provider_files_cache';

describe('provider_files_cache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-providers-'));
    clearProviderFilesCacheForTest();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a catalog under a matching fingerprint', async () => {
    await writeFile(path.join(dir, 'openrouter.json'), '{"models":[]}');
    const fp = await computeProvidersFingerprint(dir);
    expect(fp).not.toBeNull();
    const catalog = [{ name: 'openrouter' }];
    setCachedProviders(dir, fp as string, catalog);
    const hit = getCachedProviders<{ name: string }>(dir, fp as string);
    expect(hit).toEqual(catalog);
    // Shallow copy: reordering the returned array must not corrupt the cache.
    expect(hit).not.toBe(catalog);
  });

  it('misses when a provider file changes (edit or key rotation)', async () => {
    const file = path.join(dir, 'openrouter.json');
    await writeFile(file, '{"models":[]}');
    const fp1 = await computeProvidersFingerprint(dir);
    setCachedProviders(dir, fp1 as string, [{ name: 'openrouter' }]);

    // Size change guarantees a fingerprint shift even on coarse mtime clocks.
    await writeFile(file, '{"models":[{"id":"m"}]}');
    const fp2 = await computeProvidersFingerprint(dir);
    expect(fp2).not.toBe(fp1);
    expect(getCachedProviders(dir, fp2 as string)).toBeUndefined();
  });

  it('misses when a secrets file appears', async () => {
    await writeFile(path.join(dir, 'openrouter.json'), '{"models":[]}');
    const fp1 = await computeProvidersFingerprint(dir);
    setCachedProviders(dir, fp1 as string, [{ name: 'openrouter' }]);

    await writeFile(path.join(dir, 'openrouter.secrets.json'), '{}');
    const fp2 = await computeProvidersFingerprint(dir);
    expect(fp2).not.toBe(fp1);
    expect(getCachedProviders(dir, fp2 as string)).toBeUndefined();
  });

  it('returns null for an unreadable directory (caller owns the error)', async () => {
    expect(
      await computeProvidersFingerprint(path.join(dir, 'missing')),
    ).toBeNull();
  });
});
