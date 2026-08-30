/**
 * Gating + identity resolution for the BUNDLED object store — the S3 the
 * stack ships with itself (`object-store` in compose / `tale deploy`).
 *
 * 0.5 made S3-compatible storage the ONLY blob backend: Convex `_storage`
 * died with the component, and `backend/lib/object-store.ts` resolves an
 * org's own `object-storage/connection.json` first, then the deployment
 * default, then fails closed. So a deployment with nothing configured cannot
 * accept a single upload — which is why the stack now ships a default rather
 * than assuming an operator will bring one.
 *
 * Pure and dependency-free so the rules are unit-testable, and kept out of
 * the writer (`backend/domains/object_storage/bootstrap.ts`) so the decision
 * "is there a bundled store, and what is it" can be read on its own.
 *
 * The bundled store is a DEFAULT, never an override: an operator who writes
 * `default/object-storage/connection.json` (or an org that brings its own
 * bucket) keeps it. Removing the env sends the deployment back to fail-closed
 * rather than silently to a different bucket.
 */

/** Region is meaningless for a self-hosted S3 but required by the signer. */
const BUNDLED_OBJECT_STORE_REGION = 'us-east-1';

/** Default bucket the seeder creates when the operator names none. */
export const BUNDLED_OBJECT_STORE_BUCKET = 'tale-blobs';

export interface BundledObjectStore {
  endpoint: string;
  /**
   * Where a BROWSER reaches the store, when the deployment publishes it
   * somewhere other than `endpoint`. Compose sets it to the site origin,
   * behind which the proxy forwards `/<bucket>/*` to the store; `bun dev`
   * leaves it unset because its endpoint is already a loopback address the
   * browser can reach.
   */
  publicEndpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type BundledObjectStoreResolution =
  | { configured: true; store: BundledObjectStore }
  | { configured: false; reason: string };

/**
 * Read the bundled store out of an env map.
 *
 * All four of endpoint / access key / secret key are required together: a
 * half-configured store would sign requests with no key and fail at the first
 * upload, which is worse than saying so at boot.
 */
export function resolveBundledObjectStore(
  env: Record<string, string | undefined>,
): BundledObjectStoreResolution {
  const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
  if (!endpoint) {
    return { configured: false, reason: 'OBJECT_STORE_ENDPOINT is not set' };
  }
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    return {
      configured: false,
      reason: `OBJECT_STORE_ENDPOINT is not a valid URL: ${endpoint}`,
    };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      configured: false,
      reason: `OBJECT_STORE_ENDPOINT must be http(s)://, got ${protocol}`,
    };
  }

  const accessKeyId = env.OBJECT_STORE_ACCESS_KEY?.trim();
  const secretAccessKey = env.OBJECT_STORE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    return {
      configured: false,
      reason:
        'OBJECT_STORE_ACCESS_KEY and OBJECT_STORE_SECRET_KEY are both required',
    };
  }

  const publicEndpoint = env.OBJECT_STORE_PUBLIC_ENDPOINT?.trim();
  if (publicEndpoint !== undefined && publicEndpoint !== '') {
    try {
      const p = new URL(publicEndpoint).protocol;
      if (p !== 'http:' && p !== 'https:') {
        return {
          configured: false,
          reason: `OBJECT_STORE_PUBLIC_ENDPOINT must be http(s)://, got ${p}`,
        };
      }
    } catch {
      return {
        configured: false,
        reason: `OBJECT_STORE_PUBLIC_ENDPOINT is not a valid URL: ${publicEndpoint}`,
      };
    }
  }

  return {
    configured: true,
    store: {
      endpoint: endpoint.replace(/\/+$/, ''),
      ...(publicEndpoint
        ? { publicEndpoint: publicEndpoint.replace(/\/+$/, '') }
        : {}),
      bucket: env.OBJECT_STORE_BUCKET?.trim() || BUNDLED_OBJECT_STORE_BUCKET,
      region: env.OBJECT_STORE_REGION?.trim() || BUNDLED_OBJECT_STORE_REGION,
      accessKeyId,
      secretAccessKey,
    },
  };
}
