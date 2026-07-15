'use node';

/**
 * Internal `'use node'` file writers + datastore probe for the per-org knowledge
 * DB connection. Kept in a SEPARATE file from the public `actions.ts` that calls
 * them via `internal.*` so the generated api types don't collapse to `any` (the
 * Convex self-referential-api-type trap); every handler carries an explicit
 * `Promise<…>` return annotation for the same reason.
 *
 * The connection lives in per-org JSON files — no DB row carries it (mirrors
 * `providers`/`sso`). The password sidecar is SOPS-encrypted when a SOPS age key
 * is configured, plaintext otherwise (same hybrid model as `providers`).
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import {
  testDatastoreConnection,
  type DatastoreTestResult,
} from '../deployment/test_datastore_connection';
import {
  atomicWrite,
  atomicWriteSecret,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../lib/file_io';
import { invalidateOrgKnowledgeUrl } from '../lib/knowledge/db/knowledge_db';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import { checkProviderHostPolicy } from '../providers/file_actions';
import {
  parseKnowledgeConnectionJson,
  resolveKnowledgeConnectionFilePath,
  resolveKnowledgeConnectionSecretsFilePath,
  resolveKnowledgeHistoryDir,
  serializeKnowledgeConnectionJson,
  serializeKnowledgeSecretsJson,
  type KnowledgeConnectionFile,
} from './file_utils';
import {
  knowledgeConnectionArgs,
  sslmodeValidator,
  type KnowledgeConnectionProbeResult,
} from './validators';

const MAX_HISTORY_ENTRIES = 20;

/** Snapshot the current connection.json into `.history/` before overwrite. */
async function snapshotHistory(
  orgSlug: string,
  currentContent: string,
): Promise<void> {
  const historyDir = resolveKnowledgeHistoryDir(orgSlug);
  await mkdir(historyDir, { recursive: true });
  await atomicWrite(
    path.join(historyDir, `${generateHistoryTimestamp()}.json`),
    currentContent,
  );
  await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
}

/**
 * Write (or update) the org's `connection.json` and, when a `password` is
 * supplied, its SOPS secret sidecar.
 *
 * `password` semantics: a non-empty string sets/replaces the password; an empty
 * string removes the sidecar (passwordless auth); `null`/absent leaves any
 * existing sidecar untouched (so the host can be edited without re-entering the
 * password).
 */
export const writeConnection = internalAction({
  args: {
    orgSlug: v.string(),
    ...knowledgeConnectionArgs,
    password: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    // SSRF gate the host before it is ever persisted (parity with the
    // deployment-wide save path).
    checkProviderHostPolicy(`http://${args.host}:${args.port}`);
    // Re-validate through the shared schema (defence in depth — the public
    // action validated too; `serializeKnowledgeConnectionJson` re-parses) before
    // it hits disk.
    const connection: KnowledgeConnectionFile = {
      host: args.host,
      port: args.port,
      database: args.database,
      user: args.user,
      sslmode: args.sslmode,
    };
    const filePath = resolveKnowledgeConnectionFilePath(args.orgSlug);
    const serialized = serializeKnowledgeConnectionJson(connection);

    const currentContent = await readFileSafe(filePath);
    if (currentContent) {
      await snapshotHistory(args.orgSlug, currentContent);
    }
    await atomicWrite(filePath, serialized);

    if (args.password !== undefined && args.password !== null) {
      const secretsPath = resolveKnowledgeConnectionSecretsFilePath(
        args.orgSlug,
      );
      if (args.password === '') {
        await removeFileSafe(secretsPath);
      } else {
        const plaintext = serializeKnowledgeSecretsJson({
          password: args.password,
        });
        const content = hasSopsKey()
          ? encryptJsonWithSops(plaintext)
          : plaintext;
        await atomicWriteSecret(secretsPath, content);
      }
      invalidateSecretsCache(secretsPath);
    }

    invalidateOrgKnowledgeUrl(args.orgSlug);
    return null;
  },
});

/**
 * Read the org's connection config for the admin view. Never returns the
 * password — only whether one is configured.
 */
export const readConnection = internalAction({
  args: { orgSlug: v.string() },
  returns: v.object({
    configured: v.boolean(),
    host: v.optional(v.string()),
    port: v.optional(v.number()),
    database: v.optional(v.string()),
    user: v.optional(v.string()),
    sslmode: v.optional(sslmodeValidator),
    hasPassword: v.optional(v.boolean()),
  }),
  handler: async (
    _ctx,
    args,
  ): Promise<{
    configured: boolean;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    sslmode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    hasPassword?: boolean;
  }> => {
    const configRaw = await readFileSafe(
      resolveKnowledgeConnectionFilePath(args.orgSlug),
    );
    if (configRaw === null) {
      return { configured: false };
    }
    const connection = parseKnowledgeConnectionJson(configRaw);
    return {
      configured: true,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      sslmode: connection.sslmode,
      hasPassword: await knowledgePasswordConfigured(args.orgSlug),
    };
  },
});

/** True when a password sidecar exists (whether or not it is decryptable now). */
async function knowledgePasswordConfigured(orgSlug: string): Promise<boolean> {
  const raw = await readFileSafe(
    resolveKnowledgeConnectionSecretsFilePath(orgSlug),
  );
  return raw !== null && raw.trim().length > 0;
}

/** Remove the org's connection config + secrets + history (revert to default). */
export const deleteConnection = internalAction({
  args: { orgSlug: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const secretsPath = resolveKnowledgeConnectionSecretsFilePath(args.orgSlug);
    await removeFileSafe(resolveKnowledgeConnectionFilePath(args.orgSlug));
    await removeFileSafe(secretsPath);
    await removeDirSafe(resolveKnowledgeHistoryDir(args.orgSlug));
    invalidateSecretsCache(secretsPath);
    invalidateOrgKnowledgeUrl(args.orgSlug);
    return null;
  },
});

/**
 * Probe a candidate knowledge Postgres: SSRF host-gate, then the in-process
 * `testDatastoreConnection` (reports `vector`/`pg_search` availability). Adds the
 * same "pgvector missing" / "ParadeDB missing → vector-only" hints as the
 * deployment-wide test.
 */
export const probeConnection = internalAction({
  args: {
    ...knowledgeConnectionArgs,
    password: v.optional(v.union(v.string(), v.null())),
  },
  // `v.any()` (matching the deployment probe) — the handler's explicit return
  // type keeps the api types honest; the UI contract uses optional fields.
  returns: v.any(),
  handler: async (_ctx, args): Promise<KnowledgeConnectionProbeResult> => {
    checkProviderHostPolicy(`http://${args.host}:${args.port}`);

    let data: DatastoreTestResult;
    try {
      data = await testDatastoreConnection({
        host: args.host,
        port: args.port,
        database: args.database,
        user: args.user,
        password: args.password ?? '',
        sslmode: args.sslmode,
      });
    } catch (err) {
      return {
        ok: false,
        error: `Could not run the datastore connection test: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    let hint: string | undefined;
    if (data.ok && data.vector_available === false) {
      hint =
        'The `vector` (pgvector) extension is not available on this database — vector search will not work. Install it before switching.';
    } else if (data.ok && data.paradedb_available === false) {
      hint =
        'ParadeDB (`pg_search`) is not available — full-text/BM25 hybrid search will degrade to vector-only. Install ParadeDB for full search quality.';
    }

    return {
      ok: data.ok,
      latencyMs: data.latency_ms ?? undefined,
      version: data.version ?? undefined,
      vectorAvailable: data.vector_available ?? undefined,
      paradedbAvailable: data.paradedb_available ?? undefined,
      error: data.error ?? undefined,
      hint,
    };
  },
});
