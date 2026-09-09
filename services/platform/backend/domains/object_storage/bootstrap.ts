/**
 * Deployment-default object store — reconciled at boot from the environment,
 * the way the two databases are read from theirs.
 *
 * S3-compatible storage is the ONLY blob backend in 0.5 (Convex `_storage`
 * died with the component), so a deployment with nothing configured refuses
 * every upload with `OBJECT_STORE_UNCONFIGURED`. The stack therefore SHIPS a
 * store (`object-store` in compose / `tale deploy` / the dev fleet) and points
 * the default config tree at whatever `OBJECT_STORE_*` names — the bundled
 * store, or an S3-compatible bucket the operator brings.
 *
 * ## Why this reconciles rather than seeds once
 *
 * `DATABASE_URL` and `KNOWLEDGE_DATABASE_URL` are read on every boot, so
 * repointing those stores, or rotating their credentials, is an env change
 * plus a restart.
 * The blob store used to be the odd one out: the first boot copied the
 * variables into `default/object-storage/connection.json` and every later boot
 * ignored them, so rotating the store's access key meant hand-editing a
 * SOPS-encrypted file inside a container volume. Now the environment stays
 * authoritative for the files it wrote.
 *
 * ## Why an operator's edit still wins
 *
 * The original rule — "a file that already exists is never overwritten" —
 * existed to protect an operator who repointed the default by hand. That
 * protection is kept, and made explicit rather than incidental, by the
 * `managedBy` marker the file now carries:
 *
 *  - `env`      — written here; kept equal to the environment on every boot.
 *  - `operator` — never touched, whatever the environment says.
 *  - absent     — a file from before the marker existed. Adopted as `env` only
 *                 when it already names the same bucket at the same endpoint
 *                 the environment does (so it WAS an env seed); otherwise it
 *                 was repointed deliberately, and that edit outranks the env.
 *
 * Two more rules make this safe to run on every boot:
 *
 *  1. **Idempotent.** The bucket probe accepts an existing bucket, and a file
 *     already equal to the environment is left alone, so a restart is a no-op.
 *  2. **Never fails boot.** A store that is still starting up must not take
 *     the API down with it; the next upload re-reads the config, and an
 *     unconfigured deployment fails closed exactly as before.
 *
 * Every role runs this at boot and a deployment runs several of them, so the
 * whole read-compare-write is held under the default org's `object-storage`
 * write lock: without it two booting replicas both read "absent" and both
 * write the pair, and the connection can land against the other's secrets
 * sidecar.
 */

import { mkdir } from 'node:fs/promises';

import type { Sql } from 'postgres';

import {
  resolveEnvObjectStore,
  type EnvObjectStore,
} from '../../../lib/utils/env-object-store.ts';
import { withConfigWriteLock } from '../../core/lib/config_store/write_lock.ts';
import { atomicWrite, atomicWriteSecret } from '../../core/lib/file_io.ts';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../core/lib/sops.ts';
import {
  buildS3ObjectStore,
  objectUrl,
} from '../../core/lib/storage/object_store.ts';
import {
  readOrgObjectStorageConnection,
  resolveObjectStorageConnectionFilePath,
  resolveObjectStorageConnectionSecretsFilePath,
  resolveObjectStorageDir,
  serializeObjectStorageConnectionJson,
  serializeObjectStorageSecretsJson,
  type ObjectStorageConnectionFile,
  type ObjectStorageConnectionSecrets,
} from '../../core/object_storage/file_utils.ts';
import { clearObjectStoreCache } from '../../lib/object-store.ts';

/** The config tree the deployment default lives under. */
const DEFAULT_ORG_SLUG = 'default';

/** Bound on the bucket probe — a store that is reachable answers fast, and a
 * store that is not must not hold the boot sequence. */
const BUCKET_PROBE_TIMEOUT_MS = 15_000;

export type ObjectStoreBootstrap =
  /** No file; written from the environment. */
  | { status: 'seeded'; detail: string }
  /** An env-managed file brought back in line with the environment. */
  | { status: 'reconciled'; detail: string }
  /** A pre-marker file recognised as an earlier env seed and taken over. */
  | { status: 'adopted'; detail: string }
  /**
   * The environment declares a store AND the file refuses it. Its own status
   * rather than `present`, because it is the one outcome where what the
   * operator asked for is not what happened — silence there reads as "the
   * variables took effect".
   */
  | { status: 'ignored'; detail: string }
  /** Already equal to the environment; nothing to do. */
  | { status: 'present'; detail: string }
  /** The environment declares no store at all. */
  | { status: 'skipped'; detail: string };

/** The connection half of what the environment declares. */
function connectionFromEnv(store: EnvObjectStore): ObjectStorageConnectionFile {
  return {
    region: store.region,
    ...(store.endpoint === undefined ? {} : { endpoint: store.endpoint }),
    forcePathStyle: store.forcePathStyle,
    bucket: store.bucket,
    ...(store.prefix === undefined ? {} : { prefix: store.prefix }),
    ...(store.publicEndpoint === undefined
      ? {}
      : { publicEndpoint: store.publicEndpoint }),
    managedBy: 'env',
  };
}

function secretsFromEnv(store: EnvObjectStore): ObjectStorageConnectionSecrets {
  return {
    accessKeyId: store.accessKeyId,
    secretAccessKey: store.secretAccessKey,
  };
}

/**
 * Make sure the bucket is usable, creating it only when it genuinely is not
 * there.
 *
 * An unconditional `CreateBucket` is what a deployment against a bucket
 * someone else provisioned cannot survive: a least-privilege key that may read
 * and write objects but not create buckets answers 403, and the whole default
 * connection then never lands, leaving every upload refused. So probe first —
 * `HEAD` on a bucket answers 200 when it exists and is listable, 403 when it
 * exists and this key may not list it (still perfectly usable for objects),
 * and 404 only when it is really absent.
 */
async function ensureBucket(
  connection: ObjectStorageConnectionFile,
  secrets: ObjectStorageConnectionSecrets,
): Promise<void> {
  const store = buildS3ObjectStore(connection, secrets);
  // `objectUrl(store, '')` is the bucket base with a trailing slash, in the
  // addressing style this connection uses (path vs virtual-host).
  const bucketUrl = objectUrl(store, '').replace(/\/+$/, '');

  const head = await store.client.fetch(bucketUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(BUCKET_PROBE_TIMEOUT_MS),
  });
  if (head.ok) return;
  if (head.status === 403) {
    console.log(
      `[backend] bucket "${connection.bucket}" exists but this key may not list it — objects will still be read and written`,
    );
    return;
  }
  if (head.status !== 404) {
    throw new Error(
      `probing bucket "${connection.bucket}" failed: ${head.status} ${await safeBody(head)}`,
    );
  }

  const created = await store.client.fetch(bucketUrl, {
    method: 'PUT',
    signal: AbortSignal.timeout(BUCKET_PROBE_TIMEOUT_MS),
  });
  // An existing bucket answers 409 `BucketAlreadyOwnedByYou` (or 200 on MinIO
  // and legacy us-east-1) — a concurrent replica won the race, which is fine.
  if (created.ok || created.status === 409) return;
  if (created.status === 403) {
    throw new Error(
      `bucket "${connection.bucket}" does not exist and this key may not create it ` +
        '(grant s3:CreateBucket, or create the bucket yourself before starting Tale)',
    );
  }
  throw new Error(
    `creating bucket "${connection.bucket}" failed: ${created.status} ${await safeBody(created)}`,
  );
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch (error: unknown) {
    console.warn('[backend] could not read the S3 error body:', error);
    return '<unreadable body>';
  }
}

/**
 * Bring `default/object-storage/{connection,connection.secrets}.json` in line
 * with `OBJECT_STORE_*`, and make sure the bucket is usable. See the module
 * note for why each outcome is a success.
 */
export async function ensureDefaultObjectStore(
  sql: Sql,
  env: Record<string, string | undefined> = process.env,
): Promise<ObjectStoreBootstrap> {
  const resolution = resolveEnvObjectStore(env);
  if (!resolution.configured) {
    return { status: 'skipped', detail: resolution.reason };
  }
  const store = resolution.store;

  return withConfigWriteLock(sql, DEFAULT_ORG_SLUG, 'object-storage', () =>
    reconcileDefaultObjectStore(store),
  );
}

async function reconcileDefaultObjectStore(
  store: EnvObjectStore,
): Promise<ObjectStoreBootstrap> {
  const desired = connectionFromEnv(store);
  const desiredSecrets = secretsFromEnv(store);

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

  if (existing === null) {
    await ensureBucket(desired, desiredSecrets);
    await writeDefault(desired, desiredSecrets);
    return {
      status: 'seeded',
      detail: describeTarget(desired),
    };
  }

  const ownership = resolveOwnership(existing.connection, desired);
  if (ownership === 'operator') {
    return {
      status: 'ignored',
      detail:
        `the deployment default is operator-managed and points at ${describeTarget(existing.connection)} — ` +
        'OBJECT_STORE_* is ignored; set "managedBy": "env" in the file to hand it back to the environment',
    };
  }

  if (
    connectionsEqual(existing.connection, desired) &&
    secretsEqual(existing.secrets, desiredSecrets)
  ) {
    // Still re-probe: a surviving config file does not mean the STORE
    // survived. Recreating the store's volume (compose down -v, a docker
    // prune) leaves this connection pointing at a bucket that no longer
    // exists, and every upload fails `NoSuchBucket` until someone recreates
    // it by hand.
    await ensureBucket(existing.connection, existing.secrets);
    return {
      status: 'present',
      detail: `deployment default matches the environment (${describeTarget(desired)})`,
    };
  }

  await ensureBucket(desired, desiredSecrets);
  await writeDefault(desired, desiredSecrets);
  return ownership === 'adopt'
    ? {
        status: 'adopted',
        detail: `took over the pre-existing deployment default at ${describeTarget(desired)} — it is now env-managed`,
      }
    : {
        status: 'reconciled',
        detail: `updated the deployment default to ${describeTarget(desired)}`,
      };
}

/**
 * Who owns the existing file: `operator` (leave it alone), `env` (it says so),
 * or `adopt` (no marker, but it names the same bucket at the same endpoint the
 * environment does, so it was written by an earlier env seed).
 */
function resolveOwnership(
  existing: ObjectStorageConnectionFile,
  desired: ObjectStorageConnectionFile,
): 'env' | 'operator' | 'adopt' {
  if (existing.managedBy === 'env') return 'env';
  if (existing.managedBy === 'operator') return 'operator';
  const sameTarget =
    existing.bucket === desired.bucket &&
    normalizeEndpoint(existing.endpoint) ===
      normalizeEndpoint(desired.endpoint);
  return sameTarget ? 'adopt' : 'operator';
}

/** Case- and trailing-slash-insensitive endpoint identity; `null` for AWS. */
function normalizeEndpoint(endpoint: string | undefined): string | null {
  const trimmed = endpoint?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

function connectionsEqual(
  a: ObjectStorageConnectionFile,
  b: ObjectStorageConnectionFile,
): boolean {
  return (
    a.bucket === b.bucket &&
    a.region === b.region &&
    normalizeEndpoint(a.endpoint) === normalizeEndpoint(b.endpoint) &&
    normalizeEndpoint(a.publicEndpoint) ===
      normalizeEndpoint(b.publicEndpoint) &&
    a.forcePathStyle === b.forcePathStyle &&
    (a.prefix ?? '') === (b.prefix ?? '') &&
    a.managedBy === b.managedBy
  );
}

function secretsEqual(
  a: ObjectStorageConnectionSecrets,
  b: ObjectStorageConnectionSecrets,
): boolean {
  return (
    a.accessKeyId === b.accessKeyId && a.secretAccessKey === b.secretAccessKey
  );
}

function describeTarget(connection: ObjectStorageConnectionFile): string {
  const where = connection.endpoint ?? `AWS S3 (${connection.region})`;
  return `bucket "${connection.bucket}" at ${where}`;
}

/** Write both halves and drop every cached resolution of the old one. */
async function writeDefault(
  connection: ObjectStorageConnectionFile,
  secrets: ObjectStorageConnectionSecrets,
): Promise<void> {
  await mkdir(resolveObjectStorageDir(DEFAULT_ORG_SLUG), { recursive: true });
  await atomicWrite(
    resolveObjectStorageConnectionFilePath(DEFAULT_ORG_SLUG),
    serializeObjectStorageConnectionJson(connection),
  );

  const secretsPath =
    resolveObjectStorageConnectionSecretsFilePath(DEFAULT_ORG_SLUG);
  const plaintext = serializeObjectStorageSecretsJson(secrets);
  await atomicWriteSecret(
    secretsPath,
    hasSopsKey() ? await encryptJsonWithSops(plaintext) : plaintext,
  );
  invalidateSecretsCache(secretsPath);
  clearObjectStoreCache();
}
