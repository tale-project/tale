import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  collectOrgObjectStorageOrigins,
  createOrgObjectStorageOriginsProvider,
  originsForConnection,
} from './org-storage-origins';

const tempDirs: string[] = [];

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'org-storage-origins-'));
  tempDirs.push(dir);
  return dir;
}

function writeOrgConnection(
  configDir: string,
  orgSlug: string,
  content: string,
): void {
  const domainDir = join(configDir, orgSlug, 'object-storage');
  mkdirSync(domainDir, { recursive: true });
  writeFileSync(join(domainDir, 'connection.json'), content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('originsForConnection', () => {
  test('uses the endpoint origin when an endpoint is set (MinIO/R2)', () => {
    expect(
      originsForConnection({
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'blobs',
        region: 'auto',
      }),
    ).toEqual(['https://acc.r2.cloudflarestorage.com']);
  });

  test('strips path and port details down to the origin', () => {
    expect(
      originsForConnection({ endpoint: 'http://minio.internal:9100/extra' }),
    ).toEqual(['http://minio.internal:9100']);
  });

  test('derives both AWS addressing styles when no endpoint is set', () => {
    expect(
      originsForConnection({ bucket: 'my-blobs', region: 'eu-central-1' }),
    ).toEqual([
      'https://my-blobs.s3.eu-central-1.amazonaws.com',
      'https://s3.eu-central-1.amazonaws.com',
    ]);
  });

  test('returns nothing for an unparsable endpoint, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(originsForConnection({ endpoint: 'not a url' })).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  test('rejects bucket/region values outside the S3 alphabet (header-injection guard)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      originsForConnection({ bucket: 'x.com; script-src *', region: 'auto' }),
    ).toEqual([]);
    expect(
      originsForConnection({ bucket: 'ok-bucket', region: 'evil *' }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('collectOrgObjectStorageOrigins', () => {
  test('collects, dedupes and sorts origins across orgs', () => {
    const dir = makeConfigDir();
    writeOrgConnection(
      dir,
      'org-a',
      JSON.stringify({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'a-blobs',
        forcePathStyle: true,
      }),
    );
    writeOrgConnection(
      dir,
      'org-b',
      JSON.stringify({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'b-blobs',
        forcePathStyle: true,
      }),
    );
    writeOrgConnection(
      dir,
      'org-c',
      JSON.stringify({
        region: 'us-east-1',
        bucket: 'c-blobs',
        forcePathStyle: false,
      }),
    );
    expect(collectOrgObjectStorageOrigins(dir)).toEqual([
      'https://acc.r2.cloudflarestorage.com',
      'https://c-blobs.s3.us-east-1.amazonaws.com',
      'https://s3.us-east-1.amazonaws.com',
    ]);
  });

  test('ignores orgs without an object-storage config, silently', () => {
    const dir = makeConfigDir();
    mkdirSync(join(dir, 'org-without-storage', 'branding'), {
      recursive: true,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(collectOrgObjectStorageOrigins(dir)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('skips malformed JSON with a warning instead of throwing', () => {
    const dir = makeConfigDir();
    writeOrgConnection(dir, 'org-broken', '{not json');
    writeOrgConnection(
      dir,
      'org-ok',
      JSON.stringify({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'blobs',
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(collectOrgObjectStorageOrigins(dir)).toEqual([
      'https://acc.r2.cloudflarestorage.com',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('returns [] for an unreadable config dir, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      collectOrgObjectStorageOrigins(join(tmpdir(), 'does-not-exist-xyz')),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('createOrgObjectStorageOriginsProvider', () => {
  test('always returns [] without a config dir', () => {
    expect(createOrgObjectStorageOriginsProvider(null)()).toEqual([]);
    expect(createOrgObjectStorageOriginsProvider(undefined)()).toEqual([]);
  });

  test('serves cached origins inside the TTL and rescans after it', () => {
    vi.useFakeTimers();
    const dir = makeConfigDir();
    const provider = createOrgObjectStorageOriginsProvider(dir, 5000);
    expect(provider()).toEqual([]);

    // A save landing inside the TTL is not visible yet…
    writeOrgConnection(
      dir,
      'org-a',
      JSON.stringify({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        bucket: 'blobs',
      }),
    );
    expect(provider()).toEqual([]);

    // …but is after the TTL elapses.
    vi.advanceTimersByTime(5001);
    expect(provider()).toEqual(['https://acc.r2.cloudflarestorage.com']);
    vi.useRealTimers();
  });
});
