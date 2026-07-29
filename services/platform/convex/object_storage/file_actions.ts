'use node';

/**
 * Internal `'use node'` file writers + S3 probe for the per-org object-storage
 * connection. Kept in a SEPARATE file from the public `actions.ts` that calls
 * them via `internal.*` so the generated api types don't collapse to `any` (the
 * Convex self-referential-api-type trap); every handler carries an explicit
 * `Promise<…>` return annotation for the same reason.
 *
 * Mirrors `knowledge/file_actions.ts`. The connection lives in per-org JSON
 * files — no DB row carries it. The credentials sidecar is SOPS-encrypted when a
 * SOPS age key is configured, plaintext otherwise (same hybrid model as
 * `providers`/`knowledge`).
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import {
  atomicWrite,
  atomicWriteSecret,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../lib/file_io';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import {
  buildS3ObjectStore,
  invalidateOrgObjectStore,
  probeS3ObjectStore,
} from '../lib/storage/object_store';
import {
  parseObjectStorageConnectionJson,
  readObjectStorageSecrets,
  resolveObjectStorageConnectionFilePath,
  resolveObjectStorageConnectionSecretsFilePath,
  resolveObjectStorageHistoryDir,
  serializeObjectStorageConnectionJson,
  serializeObjectStorageSecretsJson,
  type ObjectStorageConnectionFile,
} from './file_utils';
import {
  objectStorageConnectionArgs,
  type ObjectStorageConnectionView,
  type ObjectStorageProbeResult,
} from './validators';

const MAX_HISTORY_ENTRIES = 20;

/** SSRF-gate an optional S3 endpoint (AWS proper has none — nothing to gate). */
function gateEndpoint(endpoint: string | undefined): void {
  if (endpoint) {
    checkProviderHostPolicy(endpoint);
  }
}

/** Assemble a validated connection object from the flat action args. */
function connectionFromArgs(args: {
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket: string;
  prefix?: string;
}): ObjectStorageConnectionFile {
  return {
    region: args.region,
    endpoint: args.endpoint,
    forcePathStyle: args.forcePathStyle ?? false,
    bucket: args.bucket,
    prefix: args.prefix,
  };
}

/** Snapshot the current connection.json into `.history/` before overwrite. */
async function snapshotHistory(
  orgSlug: string,
  currentContent: string,
): Promise<void> {
  const historyDir = resolveObjectStorageHistoryDir(orgSlug);
  await mkdir(historyDir, { recursive: true });
  await atomicWrite(
    path.join(historyDir, `${generateHistoryTimestamp()}.json`),
    currentContent,
  );
  await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
}

/**
 * Write (or update) the org's `connection.json` and, when a credential pair is
 * supplied, its SOPS secret sidecar.
 *
 * Credential semantics: BOTH `accessKeyId` and `secretAccessKey` present (and
 * non-empty) sets/replaces the sidecar; both absent leaves any existing sidecar
 * untouched (so the bucket/region can be edited without re-entering the keys).
 * S3 has no passwordless mode, so removing the sidecar is not offered here —
 * dropping the whole config (`deleteConnection`) is the way to revert.
 */
export const writeConnection = internalAction({
  args: {
    orgSlug: v.string(),
    ...objectStorageConnectionArgs,
    accessKeyId: v.optional(v.string()),
    secretAccessKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    gateEndpoint(args.endpoint);
    // Re-validate through the shared schema (defence in depth) before disk.
    const connection = connectionFromArgs(args);
    const filePath = resolveObjectStorageConnectionFilePath(args.orgSlug);
    const serialized = serializeObjectStorageConnectionJson(connection);

    const currentContent = await readFileSafe(filePath);
    if (currentContent) {
      await snapshotHistory(args.orgSlug, currentContent);
    }
    await atomicWrite(filePath, serialized);

    // Both keys present (non-empty) sets/replaces the sidecar; the locals let TS
    // narrow away `undefined` without a non-null assertion.
    const accessKeyId = args.accessKeyId;
    const secretAccessKey = args.secretAccessKey;
    if (accessKeyId && secretAccessKey) {
      const secretsPath = resolveObjectStorageConnectionSecretsFilePath(
        args.orgSlug,
      );
      const plaintext = serializeObjectStorageSecretsJson({
        accessKeyId,
        secretAccessKey,
      });
      const content = hasSopsKey() ? encryptJsonWithSops(plaintext) : plaintext;
      await atomicWriteSecret(secretsPath, content);
      invalidateSecretsCache(secretsPath);
    }

    invalidateOrgObjectStore(args.orgSlug);
    return null;
  },
});

/**
 * Read the org's connection config for the admin view. Never returns the
 * credentials — only whether they are configured.
 */
export const readConnection = internalAction({
  args: { orgSlug: v.string() },
  returns: v.object({
    configured: v.boolean(),
    region: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    forcePathStyle: v.optional(v.boolean()),
    bucket: v.optional(v.string()),
    prefix: v.optional(v.string()),
    hasCredentials: v.optional(v.boolean()),
  }),
  handler: async (_ctx, args): Promise<ObjectStorageConnectionView> => {
    const configRaw = await readFileSafe(
      resolveObjectStorageConnectionFilePath(args.orgSlug),
    );
    if (configRaw === null) {
      return { configured: false };
    }
    const connection = parseObjectStorageConnectionJson(configRaw);
    return {
      configured: true,
      region: connection.region,
      endpoint: connection.endpoint,
      forcePathStyle: connection.forcePathStyle,
      bucket: connection.bucket,
      prefix: connection.prefix,
      hasCredentials: await objectStorageCredentialsConfigured(args.orgSlug),
    };
  },
});

/** True when a credentials sidecar exists (whether or not decryptable now). */
async function objectStorageCredentialsConfigured(
  orgSlug: string,
): Promise<boolean> {
  const raw = await readFileSafe(
    resolveObjectStorageConnectionSecretsFilePath(orgSlug),
  );
  return raw !== null && raw.trim().length > 0;
}

/** Remove the org's connection config + secrets + history (revert to default). */
export const deleteConnection = internalAction({
  args: { orgSlug: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const secretsPath = resolveObjectStorageConnectionSecretsFilePath(
      args.orgSlug,
    );
    await removeFileSafe(resolveObjectStorageConnectionFilePath(args.orgSlug));
    await removeFileSafe(secretsPath);
    await removeDirSafe(resolveObjectStorageHistoryDir(args.orgSlug));
    invalidateSecretsCache(secretsPath);
    invalidateOrgObjectStore(args.orgSlug);
    return null;
  },
});

/**
 * Probe a candidate bucket + credentials with a REAL round-trip: SSRF-gate the
 * endpoint, then PUT → GET → DELETE a throwaway object. Proves the store is
 * usable before the admin commits to it. Never throws — a failure is reported as
 * `{ ok: false, error }` for the admin form.
 */
export const probeConnection = internalAction({
  args: {
    ...objectStorageConnectionArgs,
    accessKeyId: v.optional(v.string()),
    secretAccessKey: v.optional(v.string()),
    // When set and no credential pair is supplied, the probe reuses the org's
    // already stored keys. This is what makes "Save, then Test" work: Save
    // blanks the write-only key fields, so the follow-up Test carries no keys —
    // without this fallback the probe could not test a valid saved connection
    // (S3 has no passwordless mode, so blank keys can only mean "reuse stored").
    // Mirrors `knowledge/file_actions.ts` probeConnection.
    orgSlug: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<ObjectStorageProbeResult> => {
    try {
      gateEndpoint(args.endpoint);
      const credentials =
        args.accessKeyId && args.secretAccessKey
          ? {
              accessKeyId: args.accessKeyId,
              secretAccessKey: args.secretAccessKey,
            }
          : args.orgSlug
            ? await readObjectStorageSecrets(args.orgSlug)
            : undefined;
      if (!credentials) {
        return {
          ok: false,
          error: 'Enter the access key ID and the secret access key to test.',
        };
      }
      const store = buildS3ObjectStore(connectionFromArgs(args), credentials);
      await probeS3ObjectStore(store);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
