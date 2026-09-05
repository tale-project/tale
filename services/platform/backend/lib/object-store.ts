import {
  buildObjectKey,
  clearOrgObjectStoreCache,
  deleteOrgObject,
  locateOrgObject,
  locateOrgObjectStore,
  ObjectStoreUnconfiguredError,
  resolveOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
  type S3ObjectStore,
} from '../core/lib/storage/object_store.ts';

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
 * ONE resolver and ONE cache serve both this lane and the reused blob-access
 * lane (`core/lib/storage/blob_access.ts`): `resolveObjectStore` IS
 * `resolveOrgObjectStore`, so a broken default tree fails identically at
 * every door and a config write invalidates every cached resolution at once.
 *
 * `resolveObjectStore` is the MINT lane's resolver (a new key lands in the
 * org's current store). A lane that reads, serves or deletes an EXISTING ref
 * goes through `locateOrgObjectStore` / `deleteOrgObject`: an org that
 * connected its own bucket still has every earlier blob in the deployment
 * default store until the blob backfill moves it, and the ref cannot say
 * which of the two holds it.
 */

export { ObjectStoreUnconfiguredError };

/** Test hook + config-write invalidation: drop every cached resolution. */
export function clearObjectStoreCache(): void {
  clearOrgObjectStoreCache();
}

export async function resolveObjectStore(
  orgSlug: string,
): Promise<S3ObjectStore> {
  return resolveOrgObjectStore(orgSlug);
}

export {
  buildObjectKey,
  deleteOrgObject,
  locateOrgObject,
  locateOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
  type S3ObjectStore,
};
