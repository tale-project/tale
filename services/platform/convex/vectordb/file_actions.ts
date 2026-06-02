'use node';

/**
 * Deployment vector-database config I/O actions.
 *
 * Mirrors the providers pattern (file_actions + secret_io + SOPS) but for a
 * SINGLE deployment-level config (no orgSlug, no resource name). The RAG
 * service reads the written `vectordb.json` / `vectordb.secrets.json` from
 * the shared config volume and selects its driver. All four actions are
 * gated on `orgSettings` (owner/admin) because the config is deployment-wide
 * and affects every organization.
 */

import { ConvexError, v } from 'convex/values';

import { vectorDbConfigSchema } from '../../lib/shared/schemas/vectordb';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  atomicWrite,
  atomicWriteSecret,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { ragFetch } from '../lib/helpers/rag_config';
import { safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import {
  EncryptedFileWithoutKeyError,
  decryptSecretsFile,
  encryptJsonToSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
// Reuse the providers SSRF host-policy gate — the Qdrant URL is operator-
// authored and carries the same IMDS / RFC1918 risk as a provider baseUrl.
import { checkProviderHostPolicy } from '../providers/file_actions';
import { requireOrgSettingsAccessById, type OrgSettingsAuth } from './auth';
import type { VectorDbConfig } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  parseVectorDbConfig,
  parseVectorDbSecrets,
  resolveVectorDbConfigPath,
  resolveVectorDbSecretsPath,
  serializeVectorDbConfig,
} from './file_utils';
import {
  prepareMergedVectorDbSecret,
  UndecryptableExistingSecretError,
} from './secret_io';

const DEFAULT_CONFIG: VectorDbConfig = { backend: 'pgvector' };

/** Mask a stored secret for "configured?" display — first 6 + last 4. */
function maskSecret(value: string): string {
  if (value.length <= 10) return '••••••••••';
  return `${value.slice(0, 6)} … ${value.slice(-4)}`;
}

function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

/** Read a string `code` off a thrown ConvexError's structured data. */
function convexErrorCode(err: unknown): string | undefined {
  if (!(err instanceof ConvexError)) return undefined;
  const data: unknown = err.data;
  if (data !== null && typeof data === 'object' && 'code' in data) {
    const code = data.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Read the deployment config, defaulting to pgvector when the file is absent. */
async function readConfigFile(): Promise<{
  config: VectorDbConfig;
  hash: string | null;
}> {
  const result = await readJsonFile<VectorDbConfig>(
    resolveVectorDbConfigPath(),
    MAX_FILE_SIZE_BYTES,
    parseVectorDbConfig,
  );
  if (result.ok) return { config: result.data, hash: result.hash };
  if (result.error === 'not_found')
    return { config: DEFAULT_CONFIG, hash: null };
  // Corrupted / too_large / inaccessible — surface so the UI can warn rather
  // than silently masking a broken config as "pgvector".
  throw new ConvexError({
    code: 'VECTORDB_CONFIG_UNREADABLE',
    message: result.message,
  });
}

async function writeAudit(
  ctx: ActionCtx,
  auth: OrgSettingsAuth,
  auditAction: string,
  metadata: Record<string, string>,
): Promise<void> {
  // Best-effort: a successful write must not be reported as failed because
  // the audit table was unreachable.
  try {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: auth.orgId,
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.member.role,
        actorType: 'user',
        action: auditAction,
        category: 'security',
        resourceType: 'vectordb',
        resourceId: 'deployment',
        resourceName: 'Vector database',
        status: 'success',
        metadata,
      },
    );
  } catch (err) {
    console.warn(
      `[vectordb] failed to write audit log (${auditAction})`,
      sanitizeError(err),
    );
  }
}

/**
 * Read the current deployment vector-db config + masked secret state. Never
 * returns the raw API key. Defaults to pgvector when nothing is configured.
 */
export const readVectorDbConfig = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgSettingsAccessById(ctx, args.organizationId);
    const { config, hash } = await readConfigFile();

    let hasApiKey = false;
    let maskedApiKey: string | null = null;
    let hasPassword = false;
    let maskedPassword: string | null = null;
    try {
      const secrets = parseVectorDbSecrets(
        await decryptSecretsFile(resolveVectorDbSecretsPath()),
      );
      if (secrets.apiKey) {
        hasApiKey = true;
        maskedApiKey = maskSecret(secrets.apiKey);
      }
      if (secrets.password) {
        hasPassword = true;
        maskedPassword = maskSecret(secrets.password);
      }
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) {
        // No secret yet — normal.
      } else if (err instanceof EncryptedFileWithoutKeyError) {
        // A secret IS on disk, just not previewable without the age key. We
        // can't tell apiKey from password without decrypting, so mark whichever
        // the active backend uses as configured.
        if (config.backend === 'pgvector_external') hasPassword = true;
        else hasApiKey = true;
      } else {
        // Undecryptable / malformed existing file: still "configured".
        if (config.backend === 'pgvector_external') hasPassword = true;
        else hasApiKey = true;
        console.warn(
          '[readVectorDbConfig] secret preview failed',
          sanitizeError(err),
        );
      }
    }

    return {
      config,
      hash,
      hasApiKey,
      maskedApiKey,
      hasPassword,
      maskedPassword,
    };
  },
});

/**
 * Persist the deployment vector-db config. Validates, SSRF-gates the Qdrant
 * URL, supports optimistic concurrency via `expectedHash`, and audit-logs
 * (distinguishing a backend change from a same-backend tweak).
 */
export const saveVectorDbConfig = action({
  args: {
    organizationId: v.string(),
    config: v.any(),
    expectedHash: v.optional(v.string()),
    // Overwrite an unreadable existing config and skip the optimistic-
    // concurrency check. The operator opts in from the UI after being warned
    // (mirrors the secret-write `force`). Without it a corrupted vectordb.json
    // wedges every save because `readConfigFile()` throws on the prior state.
    force: v.optional(v.boolean()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const auth = await requireOrgSettingsAccessById(ctx, args.organizationId);

    const parsed = vectorDbConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_VECTORDB_CONFIG',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const config = parsed.data;

    // SSRF: the RAG service will connect to these operator-authored endpoints
    // with the stored secret. Gate them the same way provider baseUrls are.
    if (config.backend === 'qdrant') checkProviderHostPolicy(config.qdrant.url);
    if (config.backend === 'pgvector_external') {
      const { host, port } = config.pgvectorExternal;
      checkProviderHostPolicy(`http://${host}:${port}`);
    }

    let before: { config: VectorDbConfig; hash: string | null };
    try {
      before = await readConfigFile();
    } catch (err) {
      // Force lets the operator repair a corrupted config from the UI; without
      // it the unreadable prior state would block any save indefinitely.
      if (args.force && convexErrorCode(err) === 'VECTORDB_CONFIG_UNREADABLE') {
        before = { config: DEFAULT_CONFIG, hash: null };
      } else {
        throw err;
      }
    }

    if (
      !args.force &&
      args.expectedHash !== undefined &&
      before.hash !== args.expectedHash
    ) {
      throw new ConvexError({
        code: 'VECTORDB_VERSION_CONFLICT',
        message:
          'The vector-database config was modified by another operator. Reload the page to see the latest state, then re-apply your changes.',
      });
    }

    const content = serializeVectorDbConfig(config);
    await atomicWrite(resolveVectorDbConfigPath(), content);
    const hash = sha256(content);

    const backendChanged = before.config.backend !== config.backend;
    const auditAction = args.force
      ? 'force_overwrite_vectordb_config'
      : backendChanged
        ? 'vectordb_backend_changed'
        : 'vectordb_config_saved';
    await writeAudit(ctx, auth, auditAction, {
      from: before.config.backend,
      to: config.backend,
    });

    return { hash };
  },
});

/**
 * Persist the deployment vector-db secret (Qdrant API key or external pgvector
 * password). Merges with any existing secret, SOPS-encrypts when a secret is
 * configured, and refuses to clobber an unreadable existing file unless `force`
 * is set.
 */
export const saveVectorDbSecret = action({
  args: {
    organizationId: v.string(),
    apiKey: v.optional(v.string()),
    password: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireOrgSettingsAccessById(ctx, args.organizationId);
    const secretsPath = resolveVectorDbSecretsPath();

    let prepared: Awaited<ReturnType<typeof prepareMergedVectorDbSecret>>;
    try {
      prepared = await prepareMergedVectorDbSecret(
        secretsPath,
        { apiKey: args.apiKey, password: args.password },
        { force: args.force },
      );
    } catch (err) {
      // Map refuse-overwrite errors to a structured discriminator the UI can
      // act on (offer "overwrite anyway" → re-call with force: true).
      if (err instanceof EncryptedFileWithoutKeyError) {
        throw new ConvexError({
          code: 'VECTORDB_SECRET_REFUSED_OVERWRITE',
          kind: 'encrypted_no_key',
          path: secretsPath,
        });
      }
      if (err instanceof UndecryptableExistingSecretError) {
        throw new ConvexError({
          code: 'VECTORDB_SECRET_REFUSED_OVERWRITE',
          kind: 'undecryptable_existing',
          path: secretsPath,
          reason: err.reason,
        });
      }
      throw err;
    }

    const content = hasSopsKey()
      ? encryptJsonToSops(prepared.plaintext)
      : prepared.plaintext;
    await atomicWriteSecret(secretsPath, content);
    invalidateSecretsCache(secretsPath);

    if (args.force && prepared.forced) {
      await writeAudit(ctx, auth, 'force_overwrite_vectordb_secret', {
        forceReason: prepared.forceReason ?? 'unknown',
      });
    } else {
      await writeAudit(ctx, auth, 'vectordb_secret_saved', {});
    }

    return null;
  },
});

/**
 * Probe an external backend's reachability + auth from the UI before saving.
 * For Qdrant: GET `${url}/collections` with the api-key header (uses the
 * provided key, else the stored secret). For external pgvector: proxy through
 * the RAG service's admin endpoint, which actually opens a connection to the
 * candidate database (RAG owns the asyncpg stack + the right network). For
 * built-in pgvector: a static OK — the real check is the RAG `/health`,
 * surfaced as a UI hint.
 */
export const testVectorDbConnection = action({
  args: {
    organizationId: v.string(),
    config: v.any(),
    apiKey: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    backend: v.string(),
    status: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    hint: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireOrgSettingsAccessById(ctx, args.organizationId);

    const parsed = vectorDbConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_VECTORDB_CONFIG',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const config = parsed.data;

    if (config.backend === 'pgvector') {
      return {
        ok: true,
        backend: 'pgvector',
        hint: 'Built-in backend — verify it is serving via the RAG service /health endpoint.',
      };
    }

    if (config.backend === 'pgvector_external') {
      const { host, port, database, user, sslmode, table } =
        config.pgvectorExternal;
      // SSRF: same operator-authored-host gate applied on save.
      checkProviderHostPolicy(`http://${host}:${port}`);

      // Use the supplied password, else fall back to the stored secret.
      let password = args.password;
      if (!password) {
        try {
          const secrets = parseVectorDbSecrets(
            await decryptSecretsFile(resolveVectorDbSecretsPath()),
          );
          password = secrets.password;
        } catch (err) {
          if (!isErrnoCode(err, 'ENOENT')) {
            console.warn(
              '[testVectorDbConnection] secret read failed',
              sanitizeError(err),
            );
          }
        }
      }
      if (!password) {
        return {
          ok: false,
          backend: 'pgvector_external',
          error:
            'No password provided and none stored. Enter the database password and try again.',
        };
      }

      // Proxy through RAG: it owns the asyncpg stack and the network that can
      // reach the candidate DB. A deployment-level op — no X-Tale-Org header.
      const started = Date.now();
      try {
        const response = await ragFetch(
          '/api/v1/admin/vectordb/test-connection',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host,
              port,
              database,
              user,
              password,
              sslmode,
              table,
            }),
            timeoutMs: 12_000,
          },
        );
        const latencyMs = Date.now() - started;
        if (!response.ok) {
          return {
            ok: false,
            backend: 'pgvector_external',
            status: response.status,
            latencyMs,
            error: `RAG test endpoint responded ${response.status} ${response.statusText}`,
          };
        }
        // RAG uses snake_case JSON (matching its other endpoints).
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted RAG admin response shape
        const result = (await response.json()) as {
          ok: boolean;
          latency_ms?: number;
          error?: string;
          version?: string;
          pgvector_available?: boolean;
        };
        // A reachable DB without the pgvector extension can't serve vectors —
        // treat it as a failed test with an actionable message.
        if (result.ok && result.pgvector_available === false) {
          return {
            ok: false,
            backend: 'pgvector_external',
            latencyMs: result.latency_ms ?? latencyMs,
            error:
              'Connected, but the "vector" extension is not available on this database. Install pgvector (CREATE EXTENSION vector) and retry.',
          };
        }
        return {
          ok: result.ok,
          backend: 'pgvector_external',
          latencyMs: result.latency_ms ?? latencyMs,
          error: result.ok ? undefined : result.error,
        };
      } catch (err) {
        const latencyMs = Date.now() - started;
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          backend: 'pgvector_external',
          latencyMs,
          error: message,
        };
      }
    }

    const url = config.qdrant.url.replace(/\/+$/, '');
    checkProviderHostPolicy(url);

    // Use the supplied key, else fall back to the stored secret.
    let apiKey = args.apiKey;
    if (!apiKey) {
      try {
        const secrets = parseVectorDbSecrets(
          await decryptSecretsFile(resolveVectorDbSecretsPath()),
        );
        apiKey = secrets.apiKey;
      } catch (err) {
        if (!isErrnoCode(err, 'ENOENT')) {
          console.warn(
            '[testVectorDbConnection] secret read failed',
            sanitizeError(err),
          );
        }
      }
    }

    const started = Date.now();
    try {
      const response = await safeFetch(`${url}/collections`, {
        method: 'GET',
        headers: apiKey ? { 'api-key': apiKey } : {},
        timeoutMs: 8000,
      });
      const latencyMs = Date.now() - started;
      const ok = response.status >= 200 && response.status < 300;
      return {
        ok,
        backend: 'qdrant',
        status: response.status,
        latencyMs,
        error: ok
          ? undefined
          : `Qdrant responded ${response.status} ${response.statusText}`,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message =
        err instanceof SafeFetchError || err instanceof Error
          ? err.message
          : String(err);
      return { ok: false, backend: 'qdrant', latencyMs, error: message };
    }
  },
});
