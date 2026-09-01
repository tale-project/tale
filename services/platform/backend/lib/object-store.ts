import {
  buildObjectKey,
  buildS3ObjectStore,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
  type S3ObjectStore,
} from '../core/lib/storage/object_store.ts';
import { readOrgObjectStorageConnection } from '../core/object_storage/file_utils.ts';

/**
 * 0.5 object-store resolution — S3-compatible storage is THE blob backend
 * (Convex `_storage` died with the component):
 *
 *   1. the org's own `object-storage/connection.json` (BYO bucket,
 *      physical isolation), else
 *   2. the deployment default — the `default` config tree's connection
 *      (compose ships MinIO + a seeded connection at cutover), else
 *   3. fail closed: uploads are refused until storage is configured.
 *
 * The S3 mechanics (aws4fetch signing, presign lanes, key scheme) are reused
 * from `convex/lib/storage/object_store.ts` unchanged, so BYO-org configs
 * written under 0.4 keep working verbatim.
 */

export class ObjectStoreUnconfiguredError extends Error {
  constructor() {
    super(
      'No object storage configured: neither this org nor the deployment ' +
        'default tree has an object-storage/connection.json',
    );
    this.name = 'ObjectStoreUnconfiguredError';
  }
}

const STORE_TTL_MS = 15_000;
const storeCache = new Map<string, { store: S3ObjectStore; expires: number }>();

/** Test hook. */
export function clearObjectStoreCache(): void {
  storeCache.clear();
}

export async function resolveObjectStore(
  orgSlug: string,
): Promise<S3ObjectStore> {
  const cached = storeCache.get(orgSlug);
  if (cached && cached.expires > Date.now()) {
    return cached.store;
  }
  const own = await readOrgObjectStorageConnection(orgSlug);
  const resolved =
    own ??
    (orgSlug === 'default'
      ? null
      : await readOrgObjectStorageConnection('default'));
  if (!resolved) {
    throw new ObjectStoreUnconfiguredError();
  }
  const store = buildS3ObjectStore(resolved.connection, resolved.secrets);
  storeCache.set(orgSlug, { store, expires: Date.now() + STORE_TTL_MS });
  return store;
}

export {
  buildObjectKey,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
  type S3ObjectStore,
};
