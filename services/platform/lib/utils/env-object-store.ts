/**
 * The deployment-default object store, as declared by the ENVIRONMENT.
 *
 * 0.5 made S3-compatible storage the ONLY blob backend: `backend/lib/object-store.ts`
 * resolves an org's own `object-storage/connection.json` first, then the
 * deployment default, then fails closed. So a deployment with nothing
 * configured cannot accept a single upload — which is why the stack ships a
 * store and seeds this default against it.
 *
 * The store these variables describe is NOT necessarily the bundled one. A
 * deployment may point them at any S3-compatible bucket an operator brings
 * (AWS S3, MinIO, Cloudflare R2, Wasabi, …), which is the whole point of
 * running Tale against infrastructure you already own — so the four coordinate
 * fields the connection schema carries (`endpoint`, `forcePathStyle`,
 * `prefix`, `region`) all have an environment spelling here, and the writer
 * (`backend/domains/object_storage/bootstrap.ts`) RECONCILES the config file
 * from them on every boot rather than seeding once. Without that, rotating the
 * store's credentials meant hand-editing a SOPS-encrypted file inside a
 * container volume.
 *
 * Pure and dependency-free so the rules are unit-testable, and kept out of the
 * writer so the decision "what store does the environment declare, if any" can
 * be read on its own.
 */

/** Region is meaningless for a self-hosted S3 but required by the signer. */
const DEFAULT_OBJECT_STORE_REGION = 'us-east-1';

/** Default bucket the seeder creates when the operator names none. */
export const DEFAULT_OBJECT_STORE_BUCKET = 'tale-blobs';

export interface EnvObjectStore {
  /**
   * S3-compatible endpoint (MinIO/R2/Wasabi). ABSENT means AWS S3 proper,
   * addressed at `https://<bucket>.s3.<region>.amazonaws.com`.
   */
  endpoint?: string;
  /**
   * Where a BROWSER reaches the store, when the deployment publishes it
   * somewhere other than `endpoint`. Compose sets it to the site origin,
   * behind which the proxy forwards `/<bucket>/*` to the store; `bun dev`
   * leaves it unset because its endpoint is already a loopback address the
   * browser can reach, and so does a public bucket.
   */
  publicEndpoint?: string;
  bucket: string;
  region: string;
  /**
   * Path-style addressing (`endpoint/bucket/key`). Defaults to the shape the
   * endpoint implies — true for a self-hosted store, which has no per-bucket
   * DNS, and false for AWS, which deprecated path-style — and is overridable
   * for the stores that disagree with their own shape.
   */
  forcePathStyle: boolean;
  /** Optional key prefix, so Tale's blobs can share a bucket with other data. */
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type EnvObjectStoreResolution =
  | { configured: true; store: EnvObjectStore }
  | { configured: false; reason: string };

/**
 * Parse an operator-supplied boolean. Unset answers `undefined` so the caller
 * can apply its own default; anything that is not a recognised spelling is a
 * REFUSAL rather than a silent false — a typo that quietly flips addressing
 * style would surface as 404s on every object, long after boot.
 */
function parseBoolean(
  raw: string | undefined,
): boolean | undefined | 'invalid' {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '') return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return 'invalid';
}

/** `undefined` when unset; the trimmed origin when it is a usable http(s) URL;
 * an error string when it is set but unusable. */
function parseEndpoint(
  raw: string | undefined,
  name: string,
): { value?: string } | { error: string } {
  const endpoint = raw?.trim();
  if (!endpoint) return {};
  let protocol: string;
  try {
    protocol = new URL(endpoint).protocol;
  } catch {
    return { error: `${name} is not a valid URL: ${endpoint}` };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { error: `${name} must be http(s)://, got ${protocol}` };
  }
  return { value: endpoint.replace(/\/+$/, '') };
}

/**
 * Read the deployment-default store out of an env map.
 *
 * The credential pair is what makes a store CONFIGURED: an S3-compatible store
 * always needs one (there is no passwordless equivalent to Postgres peer
 * auth), and both halves are required together because signing with half a
 * credential fails at the first upload rather than at boot. Everything else
 * has a default — including the endpoint, whose absence means AWS S3 proper.
 */
export function resolveEnvObjectStore(
  env: Record<string, string | undefined>,
): EnvObjectStoreResolution {
  const accessKeyId = env.OBJECT_STORE_ACCESS_KEY?.trim();
  const secretAccessKey = env.OBJECT_STORE_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    return {
      configured: false,
      reason:
        'OBJECT_STORE_ACCESS_KEY and OBJECT_STORE_SECRET_KEY are both required',
    };
  }

  const endpoint = parseEndpoint(
    env.OBJECT_STORE_ENDPOINT,
    'OBJECT_STORE_ENDPOINT',
  );
  if ('error' in endpoint) {
    return { configured: false, reason: endpoint.error };
  }
  const publicEndpoint = parseEndpoint(
    env.OBJECT_STORE_PUBLIC_ENDPOINT,
    'OBJECT_STORE_PUBLIC_ENDPOINT',
  );
  if ('error' in publicEndpoint) {
    return { configured: false, reason: publicEndpoint.error };
  }

  const forcePathStyle = parseBoolean(env.OBJECT_STORE_FORCE_PATH_STYLE);
  if (forcePathStyle === 'invalid') {
    return {
      configured: false,
      reason: `OBJECT_STORE_FORCE_PATH_STYLE must be true or false, got "${env.OBJECT_STORE_FORCE_PATH_STYLE}"`,
    };
  }

  const prefix = env.OBJECT_STORE_PREFIX?.trim();

  return {
    configured: true,
    store: {
      ...(endpoint.value === undefined ? {} : { endpoint: endpoint.value }),
      ...(publicEndpoint.value === undefined
        ? {}
        : { publicEndpoint: publicEndpoint.value }),
      bucket: env.OBJECT_STORE_BUCKET?.trim() || DEFAULT_OBJECT_STORE_BUCKET,
      region: env.OBJECT_STORE_REGION?.trim() || DEFAULT_OBJECT_STORE_REGION,
      // A self-hosted store has no per-bucket DNS, so path-style is the only
      // shape that works there; AWS has DNS for every bucket and deprecated
      // path-style, so virtual-host is the only shape that keeps working.
      forcePathStyle: forcePathStyle ?? endpoint.value !== undefined,
      ...(prefix ? { prefix } : {}),
      accessKeyId,
      secretAccessKey,
    },
  };
}
