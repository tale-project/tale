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
  s3GetObjectBytes,
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

/**
 * How long a backend-side GET of a presigned object URL may wait for the
 * store's response HEADERS. Sized for a cold BYO endpoint on a slow link;
 * the body that follows is streamed under the client's own signal.
 */
export const PRESIGNED_FETCH_HEADER_TIMEOUT_MS = 30_000;

/**
 * GET a presigned object URL on the client's behalf, bounded. The audio
 * serve and the sandbox-blob stage both proxy bucket bytes so a presigned
 * URL never reaches an untrusted party — and both used to `fetch(url)` with
 * no signal, so a store that accepts the connection and hangs pinned the
 * request and its socket for ever (a per-chunk audio player accumulates
 * those with no recovery path). Two bounds, one helper:
 *
 *  - the header wait is capped (`TimeoutError`, which the callers' existing
 *    catch turns into the 502 they already answer for an unreachable store);
 *    the timer is cleared once headers arrive, so a legitimately large body
 *    is never cut mid-stream by a total-time cap;
 *  - the caller's request signal is forwarded, before AND after headers, so
 *    a client that goes away tears the upstream stream down with it.
 */
export async function fetchPresignedObject(
  url: string,
  opts: { signal?: AbortSignal; headerTimeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.headerTimeoutMs ?? PRESIGNED_FETCH_HEADER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(
        `presigned fetch: no response headers within ${timeoutMs}ms`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);
  const forwardAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal?.aborted) {
    forwardAbort();
  } else {
    opts.signal?.addEventListener('abort', forwardAbort, { once: true });
  }
  let settledWithHeaders = false;
  try {
    const response = await fetch(url, { signal: controller.signal });
    settledWithHeaders = true;
    return response;
  } finally {
    clearTimeout(timer);
    // After headers the listener must stay: the body still streams under the
    // caller's signal. Once the fetch has rejected there is nothing left to
    // tear down, so the caller's signal stops holding a closure of ours.
    if (!settledWithHeaders) {
      opts.signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

export {
  buildObjectKey,
  deleteOrgObject,
  locateOrgObject,
  locateOrgObjectStore,
  resolveOrgObjectStoresForRead,
  s3DeleteObject,
  s3GetObjectBytes,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
  s3PutObject,
  type S3ObjectStore,
};
