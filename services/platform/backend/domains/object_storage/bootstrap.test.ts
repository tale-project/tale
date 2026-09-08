// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readObjectStorageSecrets,
  type ObjectStorageConnectionSecrets,
} from '../../core/object_storage/file_utils';
import { ensureDefaultObjectStore } from './bootstrap';

/**
 * The deployment-default blob store's boot reconcile.
 *
 * Two promises are load-bearing here and both are silent when broken, which
 * is why they get a test each rather than a shared happy path: the
 * environment stays authoritative for the files it wrote (so an operator can
 * rotate an external bucket's credentials without hand-editing a
 * SOPS-encrypted file in a volume), and an operator's own edit is never
 * overwritten (so a hand-repointed store survives every restart).
 */

/**
 * The reconcile takes the object-storage domain's config-store write lock,
 * which needs a database handle. These tests are about the files, so the
 * double just runs the callback.
 */
function fakeSql(): Sql {
  const tag = () => Promise.resolve([]);
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { begin } as unknown as Sql;
}

const ENV = {
  OBJECT_STORE_ENDPOINT: 'http://object-store:9000',
  OBJECT_STORE_ACCESS_KEY: 'tale',
  OBJECT_STORE_SECRET_KEY: 'secret',
  OBJECT_STORE_BUCKET: 'tale-blobs',
};

let configRoot: string;
let savedConfigDir: string | undefined;
/** Every S3 request the reconcile issued, in order. */
let calls: { url: string; method: string }[];

/** Answer the bucket probe (and any create) with the given statuses. */
function stubS3(...statuses: number[]): void {
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: { method?: string }) => {
      calls.push({
        url: String(input instanceof Request ? input.url : input),
        method: init?.method ?? (input as Request).method ?? 'GET',
      });
      const status = statuses[Math.min(index, statuses.length - 1)] ?? 200;
      index += 1;
      return Promise.resolve(new Response('', { status }));
    }),
  );
}

function connectionPath(): string {
  return path.join(configRoot, 'default', 'object-storage', 'connection.json');
}

function secretsPath(): string {
  return path.join(
    configRoot,
    'default',
    'object-storage',
    'connection.secrets.json',
  );
}

async function writeExisting(
  connection: Record<string, unknown>,
  secrets: Record<string, unknown> = {
    accessKeyId: 'tale',
    secretAccessKey: 'secret',
  },
): Promise<void> {
  await mkdir(path.dirname(connectionPath()), { recursive: true });
  await writeFile(connectionPath(), JSON.stringify(connection, null, 2) + '\n');
  await writeFile(secretsPath(), JSON.stringify(secrets, null, 2) + '\n');
}

async function readConnection(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(connectionPath(), 'utf8')) as Record<
    string,
    unknown
  >;
}

/**
 * The credentials as the APP reads them — through the same decrypt the
 * resolver uses, so the assertion holds whether or not this environment has a
 * SOPS key configured.
 */
async function readSecrets(): Promise<ObjectStorageConnectionSecrets> {
  return readObjectStorageSecrets('default');
}

beforeEach(async () => {
  calls = [];
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-object-store-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  // A bucket that already exists — the common case on every restart.
  stubS3(200);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

describe('ensureDefaultObjectStore', () => {
  it('skips, without writing anything, when the environment declares no store', async () => {
    const result = await ensureDefaultObjectStore(fakeSql(), {});
    expect(result.status).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('seeds the pair and stamps it env-managed on a fresh deployment', async () => {
    const result = await ensureDefaultObjectStore(fakeSql(), ENV);
    expect(result.status).toBe('seeded');
    await expect(readConnection()).resolves.toMatchObject({
      bucket: 'tale-blobs',
      endpoint: 'http://object-store:9000',
      forcePathStyle: true,
      managedBy: 'env',
    });
    await expect(readSecrets()).resolves.toMatchObject({
      accessKeyId: 'tale',
      secretAccessKey: 'secret',
    });
  });

  it('is a no-op when the file already matches the environment', async () => {
    await ensureDefaultObjectStore(fakeSql(), ENV);
    const before = await readConnection();
    calls = [];

    const result = await ensureDefaultObjectStore(fakeSql(), ENV);

    expect(result.status).toBe('present');
    await expect(readConnection()).resolves.toEqual(before);
    // Still re-probed: `compose down -v` can delete the bucket out from
    // under a config file that survived.
    expect(calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('rewrites the credentials when the environment rotates them', async () => {
    await ensureDefaultObjectStore(fakeSql(), ENV);

    const result = await ensureDefaultObjectStore(fakeSql(), {
      ...ENV,
      OBJECT_STORE_SECRET_KEY: 'rotated',
    });

    // The whole point: rotating an external bucket's key is an env change and
    // a restart, not a hand-edit of a SOPS file inside a container volume.
    expect(result.status).toBe('reconciled');
    await expect(readSecrets()).resolves.toMatchObject({
      secretAccessKey: 'rotated',
    });
  });

  it('repoints the store when the environment names a different bucket', async () => {
    await ensureDefaultObjectStore(fakeSql(), ENV);

    const result = await ensureDefaultObjectStore(fakeSql(), {
      ...ENV,
      OBJECT_STORE_ENDPOINT: 'https://s3.eu-central-1.amazonaws.com',
      OBJECT_STORE_BUCKET: 'acme-tale',
    });

    expect(result.status).toBe('reconciled');
    await expect(readConnection()).resolves.toMatchObject({
      bucket: 'acme-tale',
      endpoint: 'https://s3.eu-central-1.amazonaws.com',
    });
  });

  it('never touches a file the operator claimed', async () => {
    await writeExisting({
      region: 'us-east-1',
      endpoint: 'https://minio.corp.example',
      forcePathStyle: true,
      bucket: 'hand-written',
      managedBy: 'operator',
    });

    const result = await ensureDefaultObjectStore(fakeSql(), ENV);

    // Its own status, not `present`: this is the one outcome where the
    // environment asked for something and did not get it, and boot logs
    // every status except `present`.
    expect(result.status).toBe('ignored');
    expect(result.detail).toContain('operator-managed');
    await expect(readConnection()).resolves.toMatchObject({
      bucket: 'hand-written',
    });
    // Not even a probe: this store is none of the reconcile's business.
    expect(calls).toHaveLength(0);
  });

  describe('a file written before the marker existed', () => {
    it('is adopted when it names the store the environment names', async () => {
      // It can only have got there via an earlier env seed.
      await writeExisting({
        region: 'us-east-1',
        endpoint: 'http://object-store:9000',
        forcePathStyle: true,
        bucket: 'tale-blobs',
      });

      const result = await ensureDefaultObjectStore(fakeSql(), ENV);

      expect(result.status).toBe('adopted');
      await expect(readConnection()).resolves.toMatchObject({
        managedBy: 'env',
      });
    });

    it('is left alone when it names a different store', async () => {
      // Someone repointed it deliberately; that edit outranks the env.
      await writeExisting({
        region: 'us-east-1',
        endpoint: 'https://minio.corp.example',
        forcePathStyle: true,
        bucket: 'corp-blobs',
      });

      const result = await ensureDefaultObjectStore(fakeSql(), ENV);

      expect(result.status).toBe('ignored');
      await expect(readConnection()).resolves.toMatchObject({
        bucket: 'corp-blobs',
      });
      expect(await readConnection()).not.toHaveProperty('managedBy');
    });
  });

  describe('the bucket probe', () => {
    it('creates the bucket only when it is really absent', async () => {
      stubS3(404, 200);
      const result = await ensureDefaultObjectStore(fakeSql(), ENV);
      expect(result.status).toBe('seeded');
      expect(calls.map((c) => c.method)).toEqual(['HEAD', 'PUT']);
    });

    it('accepts a bucket this key may not list', async () => {
      // The least-privilege case: read/write objects, no s3:ListBucket. The
      // old unconditional CreateBucket turned this into a deployment that
      // booted and then refused every upload.
      stubS3(403);
      const result = await ensureDefaultObjectStore(fakeSql(), ENV);
      expect(result.status).toBe('seeded');
      expect(calls.map((c) => c.method)).toEqual(['HEAD']);
    });

    it('says what permission is missing when it may not create one', async () => {
      stubS3(404, 403);
      await expect(ensureDefaultObjectStore(fakeSql(), ENV)).rejects.toThrow(
        /s3:CreateBucket/,
      );
    });

    it('addresses an AWS bucket virtual-host style', async () => {
      const { OBJECT_STORE_ENDPOINT: _drop, ...aws } = ENV;
      await ensureDefaultObjectStore(fakeSql(), {
        ...aws,
        OBJECT_STORE_BUCKET: 'acme-tale',
        OBJECT_STORE_REGION: 'eu-central-1',
      });
      // Bucket in the HOST, not the path — path-style is what AWS deprecated.
      expect(calls[0]?.url).toBe(
        'https://acme-tale.s3.eu-central-1.amazonaws.com/',
      );
    });
  });
});
