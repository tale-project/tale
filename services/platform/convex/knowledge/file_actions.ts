'use node';

/**
 * Internal `'use node'` file writers + datastore probe for the per-org knowledge
 * DB connection and embedding config. Kept in a SEPARATE file from the public
 * `actions.ts` that calls them via `internal.*` so the generated api types don't
 * collapse to `any` (the Convex self-referential-api-type trap); every handler
 * carries an explicit `Promise<…>` return annotation for the same reason.
 *
 * Both configs live in per-org JSON files — no DB row carries them (mirrors
 * `object_storage`/`providers`/`sso`). The read side and the path resolvers live
 * in `connection.ts`; this module owns the write side. The password sidecar is
 * SOPS-encrypted when a SOPS age key is configured, plaintext otherwise (same
 * hybrid model as `providers`).
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  KNOWLEDGE_CONNECTION_KEY,
  KNOWLEDGE_EMBEDDING_KEY,
  knowledgeConnectionSchema,
  knowledgeConnectionSecretsSchema,
  knowledgeEmbeddingSchema,
  type KnowledgeConnection,
  type KnowledgeConnectionSecrets,
  type KnowledgeEmbeddingConfig,
} from '../../lib/shared/schemas/knowledge';
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
  safeJoinWithinDir,
} from '../lib/file_io';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import {
  connectionFilePath,
  connectionSecretsFilePath,
  embeddingFilePath,
  knowledgeConfigDir,
  readPassword,
} from './connection';
import { invalidateOrgUrl } from './pool';
import {
  knowledgeConnectionArgs,
  knowledgeEmbeddingArgs,
  sslmodeValidator,
  type KnowledgeConnectionProbeResult,
  type KnowledgeConnectionView,
  type KnowledgeEmbeddingView,
} from './validators';

const MAX_HISTORY_ENTRIES = 20;

/** `<org>/knowledge/.history/<key>` — per-file history snapshots. */
function historyDir(orgSlug: string, key: string): string {
  return safeJoinWithinDir(
    safeJoinWithinDir(knowledgeConfigDir(orgSlug), '.history'),
    key,
  );
}

/** Serialize the connection to its canonical on-disk form (re-validating). */
function serializeConnectionJson(connection: KnowledgeConnection): string {
  return (
    JSON.stringify(knowledgeConnectionSchema.parse(connection), null, 2) + '\n'
  );
}

/** Parse + validate `connection.json`. Throws on invalid input. */
function parseConnectionJson(content: string): KnowledgeConnection {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeConnectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge connection config', result.error),
    );
  }
  return result.data;
}

/** Serialize the password sidecar. */
function serializeSecretsJson(secrets: KnowledgeConnectionSecrets): string {
  return (
    JSON.stringify(knowledgeConnectionSecretsSchema.parse(secrets), null, 2) +
    '\n'
  );
}

/** Serialize the embedding config to its canonical on-disk form. */
function serializeEmbeddingJson(config: KnowledgeEmbeddingConfig): string {
  return JSON.stringify(knowledgeEmbeddingSchema.parse(config), null, 2) + '\n';
}

/** Parse + validate `embedding.json`. Throws on invalid input. */
function parseEmbeddingJson(content: string): KnowledgeEmbeddingConfig {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeEmbeddingSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge embedding config', result.error),
    );
  }
  return result.data;
}

/** Snapshot the current file content into its `.history/<key>/` dir. */
async function snapshotHistory(
  orgSlug: string,
  key: string,
  currentContent: string,
): Promise<void> {
  const dir = historyDir(orgSlug, key);
  await mkdir(dir, { recursive: true });
  await atomicWrite(
    path.join(dir, `${generateHistoryTimestamp()}.json`),
    currentContent,
  );
  await pruneHistory(dir, MAX_HISTORY_ENTRIES);
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
    // action validated too; `serializeConnectionJson` re-parses) before it
    // hits disk.
    const connection: KnowledgeConnection = {
      host: args.host,
      port: args.port,
      database: args.database,
      user: args.user,
      sslmode: args.sslmode,
    };
    const filePath = connectionFilePath(args.orgSlug);
    const serialized = serializeConnectionJson(connection);

    const currentContent = await readFileSafe(filePath);
    if (currentContent) {
      await snapshotHistory(
        args.orgSlug,
        KNOWLEDGE_CONNECTION_KEY,
        currentContent,
      );
    }
    await atomicWrite(filePath, serialized);

    if (args.password !== undefined && args.password !== null) {
      const secretsPath = connectionSecretsFilePath(args.orgSlug);
      if (args.password === '') {
        await removeFileSafe(secretsPath);
      } else {
        const plaintext = serializeSecretsJson({ password: args.password });
        const content = hasSopsKey()
          ? encryptJsonWithSops(plaintext)
          : plaintext;
        await atomicWriteSecret(secretsPath, content);
      }
      invalidateSecretsCache(secretsPath);
    }

    invalidateOrgUrl(args.orgSlug);
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
  handler: async (_ctx, args): Promise<KnowledgeConnectionView> => {
    const configRaw = await readFileSafe(connectionFilePath(args.orgSlug));
    if (configRaw === null) {
      return { configured: false };
    }
    const connection = parseConnectionJson(configRaw);
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
  const raw = await readFileSafe(connectionSecretsFilePath(orgSlug));
  return raw !== null && raw.trim().length > 0;
}

/** Remove the org's connection config + secrets + history (revert to default). */
export const deleteConnection = internalAction({
  args: { orgSlug: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    const secretsPath = connectionSecretsFilePath(args.orgSlug);
    await removeFileSafe(connectionFilePath(args.orgSlug));
    await removeFileSafe(secretsPath);
    await removeDirSafe(historyDir(args.orgSlug, KNOWLEDGE_CONNECTION_KEY));
    invalidateSecretsCache(secretsPath);
    invalidateOrgUrl(args.orgSlug);
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
    // When set and no password is supplied, the probe reuses the org's already
    // stored secret. This is what makes "Save, then Test" work: Save blanks the
    // write-only password field, so the follow-up Test carries no password —
    // without this fallback the probe would authenticate with an empty string
    // and fail against a valid saved connection (contradicting the field hint
    // "leave blank to keep the stored value").
    orgSlug: v.optional(v.string()),
  },
  // `v.any()` (matching the deployment probe) — the handler's explicit return
  // type keeps the api types honest; the UI contract uses optional fields.
  returns: v.any(),
  handler: async (_ctx, args): Promise<KnowledgeConnectionProbeResult> => {
    checkProviderHostPolicy(`http://${args.host}:${args.port}`);

    let password: string;
    try {
      password =
        args.password != null && args.password !== ''
          ? args.password
          : args.orgSlug
            ? await readPassword(args.orgSlug)
            : '';
    } catch (err) {
      // A stored-but-unreadable sidecar (SOPS key absent on this node, corrupt
      // file) is a probe RESULT the admin needs to read, not a throw Convex
      // would redact to "Server Error" in production — this is exactly the
      // misconfiguration the probe exists to diagnose.
      return {
        ok: false,
        error: `Could not read the stored password: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    let data: DatastoreTestResult;
    try {
      data = await testDatastoreConnection({
        host: args.host,
        port: args.port,
        database: args.database,
        user: args.user,
        password,
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

/**
 * Write (or update) the org's `embedding.json`. No sidecar — the config names
 * a provider/credential but never carries a secret itself — and no cache to
 * invalidate: the embedding config is read from disk per search.
 */
export const writeEmbedding = internalAction({
  args: {
    orgSlug: v.string(),
    ...knowledgeEmbeddingArgs,
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    // A custom OpenAI-compatible endpoint is an outbound URL an admin typed —
    // same SSRF gate as every other user-supplied provider endpoint.
    if (args.baseUrl) {
      checkProviderHostPolicy(args.baseUrl);
    }
    const config: KnowledgeEmbeddingConfig = {
      providerSlug: args.providerSlug,
      credentialId: args.credentialId,
      model: args.model,
      dimensions: args.dimensions,
      baseUrl: args.baseUrl,
    };
    const filePath = embeddingFilePath(args.orgSlug);
    const serialized = serializeEmbeddingJson(config);

    const currentContent = await readFileSafe(filePath);
    if (currentContent) {
      await snapshotHistory(
        args.orgSlug,
        KNOWLEDGE_EMBEDDING_KEY,
        currentContent,
      );
    }
    await atomicWrite(filePath, serialized);
    return null;
  },
});

/** Read the org's embedding config for the admin view. */
export const readEmbedding = internalAction({
  args: { orgSlug: v.string() },
  returns: v.object({
    configured: v.boolean(),
    providerSlug: v.optional(v.string()),
    credentialId: v.optional(v.string()),
    model: v.optional(v.string()),
    dimensions: v.optional(v.number()),
    baseUrl: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<KnowledgeEmbeddingView> => {
    const raw = await readFileSafe(embeddingFilePath(args.orgSlug));
    if (raw === null) {
      return { configured: false };
    }
    const config = parseEmbeddingJson(raw);
    return {
      configured: true,
      providerSlug: config.providerSlug,
      credentialId: config.credentialId,
      model: config.model,
      dimensions: config.dimensions,
      baseUrl: config.baseUrl,
    };
  },
});

/** Remove the org's embedding config + its history (search then refuses
 * again rather than guessing a model). */
export const deleteEmbedding = internalAction({
  args: { orgSlug: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    await removeFileSafe(embeddingFilePath(args.orgSlug));
    await removeDirSafe(historyDir(args.orgSlug, KNOWLEDGE_EMBEDDING_KEY));
    return null;
  },
});
