/**
 * Deployment-default object store — bootstrapped at boot, the way the
 * knowledge corpus is.
 *
 * S3-compatible storage is the ONLY blob backend in 0.5 (Convex `_storage`
 * died with the component), so a deployment with nothing configured refuses
 * every upload with `OBJECT_STORE_UNCONFIGURED`. The stack therefore SHIPS a
 * store (`object-store` in compose / `tale deploy` / the dev fleet) and seeds
 * its connection here, so `docker compose up`, `tale deploy` and `bun dev`
 * all reach a deployment where uploading a file works.
 *
 * Three rules make this safe to run on every boot:
 *
 *  1. **Default, never override.** A `default/object-storage/connection.json`
 *     that already exists is left exactly as it is — the operator (or a
 *     previous seed) owns it. Per-org BYO buckets are resolved before the
 *     default and are untouched either way.
 *  2. **Idempotent.** Creating a bucket that exists answers 409/200 and is
 *     treated as success, so a restart is a no-op.
 *  3. **Never fails boot.** A store that is still starting up must not take
 *     the API down with it; the next upload re-reads the config, and an
 *     unseeded deployment fails closed exactly as before.
 */

import { mkdir } from 'node:fs/promises';

import { atomicWrite, atomicWriteSecret } from '../../../convex/lib/file_io.ts';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../../convex/lib/sops.ts';
import { buildS3ObjectStore } from '../../../convex/lib/storage/object_store.ts';
import {
  readOrgObjectStorageConnection,
  resolveObjectStorageConnectionFilePath,
  resolveObjectStorageConnectionSecretsFilePath,
  resolveObjectStorageDir,
  serializeObjectStorageConnectionJson,
  serializeObjectStorageSecretsJson,
} from '../../../convex/object_storage/file_utils.ts';
import {
  resolveBundledObjectStore,
  type BundledObjectStore,
} from '../../../lib/utils/bundled-object-store.ts';
import { clearObjectStoreCache } from '../../lib/object-store.ts';

/** The config tree the deployment default lives under. */
const DEFAULT_ORG_SLUG = 'default';

export type ObjectStoreBootstrap =
  | { status: 'seeded'; detail: string }
  | { status: 'present'; detail: string }
  | { status: 'skipped'; detail: string };

/**
 * Create the bucket. An existing bucket answers 409 `BucketAlreadyExists` or
 * 200 (MinIO answers 200 for the same owner), and both mean "usable" — the
 * only failure worth reporting is one that leaves nowhere to write.
 */
async function ensureBucket(store: BundledObjectStore): Promise<void> {
  const s3 = buildS3ObjectStore(
    {
      region: store.region,
      endpoint: store.endpoint,
      forcePathStyle: true,
      bucket: store.bucket,
    },
    { accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey },
  );
  const response = await s3.client.fetch(`${store.endpoint}/${store.bucket}`, {
    method: 'PUT',
  });
  if (response.ok || response.status === 409) return;
  throw new Error(
    `creating bucket "${store.bucket}" failed: ${response.status} ${await response.text()}`,
  );
}

/**
 * Seed `default/object-storage/{connection,connection.secrets}.json` from the
 * bundled-store env, and create the bucket. See the module note for why each
 * of the three outcomes is a success.
 */
export async function ensureDefaultObjectStore(
  env: Record<string, string | undefined> = process.env,
): Promise<ObjectStoreBootstrap> {
  const resolution = resolveBundledObjectStore(env);
  if (!resolution.configured) {
    return { status: 'skipped', detail: resolution.reason };
  }
  const store = resolution.store;

  const existing = await readOrgObjectStorageConnection(DEFAULT_ORG_SLUG).catch(
    // A connection.json whose secrets sidecar is missing or undecryptable
    // throws — that is the operator's config to fix, and overwriting it here
    // would destroy their bucket reference. Report it, change nothing.
    (error: unknown) => {
      throw new Error(
        `the deployment default object-storage config exists but cannot be read: ${String(error)}`,
      );
    },
  );
  if (existing !== null) {
    return {
      status: 'present',
      detail: `deployment default already points at bucket "${existing.connection.bucket}"`,
    };
  }

  await ensureBucket(store);

  await mkdir(resolveObjectStorageDir(DEFAULT_ORG_SLUG), { recursive: true });
  await atomicWrite(
    resolveObjectStorageConnectionFilePath(DEFAULT_ORG_SLUG),
    serializeObjectStorageConnectionJson({
      region: store.region,
      endpoint: store.endpoint,
      // Self-hosted S3 addresses buckets by path; virtual-host style would
      // need per-bucket DNS the deployment does not have.
      forcePathStyle: true,
      bucket: store.bucket,
    }),
  );

  const secretsPath =
    resolveObjectStorageConnectionSecretsFilePath(DEFAULT_ORG_SLUG);
  const plaintext = serializeObjectStorageSecretsJson({
    accessKeyId: store.accessKeyId,
    secretAccessKey: store.secretAccessKey,
  });
  await atomicWriteSecret(
    secretsPath,
    hasSopsKey() ? encryptJsonWithSops(plaintext) : plaintext,
  );
  invalidateSecretsCache(secretsPath);
  clearObjectStoreCache();

  return {
    status: 'seeded',
    detail: `bucket "${store.bucket}" at ${store.endpoint}`,
  };
}
