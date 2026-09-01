'use node';

/**
 * Per-organization object-storage config file utilities.
 *
 * Pure path + (de)serialization + resolution helpers for the `object-storage`
 * config domain (admin-on-demand, one file per org, no builtin catalog). On
 * disk, mirroring `knowledge`/`providers`/`sso`:
 *   {TALE_CONFIG_DIR}/<orgSlug>/object-storage/connection.json          (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/object-storage/connection.secrets.json  (SOPS)
 *
 * The connection is read by the object-store resolver (`lib/storage/
 * object_store.ts`, `'use node'`) to route an org's blobs at its own S3 bucket.
 * The admin read/save/delete actions mirror `knowledge/file_actions.ts`.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  OBJECT_STORAGE_CONFIG_DOMAIN,
  OBJECT_STORAGE_CONNECTION_KEY,
  objectStorageConnectionFileSchema,
  objectStorageConnectionSecretsSchema,
  type ObjectStorageConnectionFile,
  type ObjectStorageConnectionSecrets,
} from '../../../lib/shared/schemas/object_storage';
import {
  errnoCode,
  getConfigRoot,
  readFileSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';

export type { ObjectStorageConnectionFile, ObjectStorageConnectionSecrets };
export { OBJECT_STORAGE_CONFIG_DOMAIN, OBJECT_STORAGE_CONNECTION_KEY };

export const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB

/** `<orgSlug>/object-storage/` — the org's object-storage config directory. */
export function resolveObjectStorageDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot(OBJECT_STORAGE_CONFIG_DOMAIN),
    orgSlug,
    OBJECT_STORAGE_CONFIG_DOMAIN,
  );
}

/** `<orgSlug>/object-storage/connection.json` — non-secret bucket config. */
export function resolveObjectStorageConnectionFilePath(
  orgSlug: string,
): string {
  return safeJoinWithinDir(
    resolveObjectStorageDir(orgSlug),
    `${OBJECT_STORAGE_CONNECTION_KEY}.json`,
  );
}

/** `<orgSlug>/object-storage/connection.secrets.json` — SOPS credentials. */
export function resolveObjectStorageConnectionSecretsFilePath(
  orgSlug: string,
): string {
  return safeJoinWithinDir(
    resolveObjectStorageDir(orgSlug),
    `${OBJECT_STORAGE_CONNECTION_KEY}.secrets.json`,
  );
}

/** `<orgSlug>/object-storage/.history/connection` — config history snapshots. */
export function resolveObjectStorageHistoryDir(orgSlug: string): string {
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveObjectStorageDir(orgSlug), '.history'),
    OBJECT_STORAGE_CONNECTION_KEY,
  );
}

/** Serialize the bucket config to its canonical on-disk form. */
export function serializeObjectStorageConnectionJson(
  config: ObjectStorageConnectionFile,
): string {
  return (
    JSON.stringify(objectStorageConnectionFileSchema.parse(config), null, 2) +
    '\n'
  );
}

/** Parse + validate `connection.json`. Throws on invalid input. */
export function parseObjectStorageConnectionJson(
  content: string,
): ObjectStorageConnectionFile {
  const parsed: unknown = JSON.parse(content);
  const result = objectStorageConnectionFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid object-storage connection config', result.error),
    );
  }
  return result.data;
}

/** Serialize the credentials sidecar. */
export function serializeObjectStorageSecretsJson(
  secrets: ObjectStorageConnectionSecrets,
): string {
  return (
    JSON.stringify(
      objectStorageConnectionSecretsSchema.parse(secrets),
      null,
      2,
    ) + '\n'
  );
}

/** Parse + validate `connection.secrets.json`. Throws on invalid input. */
export function parseObjectStorageSecretsJson(
  content: string,
): ObjectStorageConnectionSecrets {
  const parsed: unknown = JSON.parse(content);
  const result = objectStorageConnectionSecretsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid object-storage secrets file', result.error),
    );
  }
  return result.data;
}

export interface ResolvedObjectStorageConnection {
  connection: ObjectStorageConnectionFile;
  secrets: ObjectStorageConnectionSecrets;
}

/**
 * Read + resolve an org's object-storage connection.
 *
 * Returns `null` when the org has NO `connection.json` — the caller then uses
 * the deployment default (Convex `_storage`). Returns the bucket config +
 * decrypted credentials when present.
 *
 * FAIL-CLOSED: throws when `connection.json` is present but invalid, or when the
 * credentials sidecar is missing/undecryptable. Never falls back to the shared
 * default store for a misconfigured per-org bucket — mis-routing a tenant's
 * blobs into the shared store is worse than erroring.
 */
export async function readOrgObjectStorageConnection(
  orgSlug: string,
): Promise<ResolvedObjectStorageConnection | null> {
  const configRaw = await readFileSafe(
    resolveObjectStorageConnectionFilePath(orgSlug),
  );
  if (configRaw === null) {
    return null;
  }
  const connection = parseObjectStorageConnectionJson(configRaw);
  const secrets = await readObjectStorageSecrets(orgSlug);
  return { connection, secrets };
}

/**
 * Read + decrypt the org's S3 credentials from the SOPS sidecar. A present
 * `connection.json` REQUIRES credentials (S3 has no passwordless mode), so an
 * absent/undecryptable sidecar throws — fail closed rather than sign requests
 * with no key.
 */
export async function readObjectStorageSecrets(
  orgSlug: string,
): Promise<ObjectStorageConnectionSecrets> {
  const secretsPath = resolveObjectStorageConnectionSecretsFilePath(orgSlug);
  let raw: Record<string, unknown>;
  try {
    raw = await decryptSecretsFile(secretsPath);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') {
      throw new Error(
        `object-storage credentials missing for org '${orgSlug}': ` +
          `${OBJECT_STORAGE_CONNECTION_KEY}.secrets.json not found`,
        { cause: err },
      );
    }
    throw err;
  }
  const parsed = objectStorageConnectionSecretsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      zodErrorMessage(
        `Invalid object-storage credentials for org '${orgSlug}'`,
        parsed.error,
      ),
    );
  }
  return parsed.data;
}
