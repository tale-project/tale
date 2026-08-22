'use node';

/**
 * Deployment-config Convex actions (INSTANCE-level, not org-scoped).
 *
 * read/save/saveSecret for the single `<configRoot>/deployment.json` (+ SOPS
 * `deployment.secrets.json`). Mirrors the providers file-actions pattern
 * (optimistic-hash concurrency, masked-secret preview, force-overwrite
 * confirm, audit logging) but gated by `requireInstanceAdmin` (writes also
 * require the caller's email in the `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist)
 * rather than per-org `developerSettings`.
 *
 * The connection-test action (`testDeploymentConnection`) lives alongside
 * these once the RAG admin endpoint + S3 SDK land.
 */

import { unlink } from 'node:fs/promises';

import { ConvexError, v } from 'convex/values';

import type {
  DeploymentConfig,
  DeploymentSecretKey,
} from '../../lib/shared/schemas/deployment';
import {
  DEPLOYMENT_CONFIG_VERSION,
  DEPLOYMENT_SECRET_KEYS,
  convexStorageSchema,
  deploymentConfigSchema,
  pgConnectionSchema,
} from '../../lib/shared/schemas/deployment';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  atomicWrite,
  atomicWriteSecret,
  errnoCode,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import { SafeFetchError, safeFetch } from '../lib/http/safe_fetch';
import {
  EncryptedFileWithoutKeyError,
  decryptSecretsFile,
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../lib/sops';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { type InstanceAdminAuth, requireInstanceAdmin } from './auth';
import { isDeploymentEditor } from './editors';
import {
  MAX_FILE_SIZE_BYTES,
  parseDeploymentConfig,
  parseDeploymentSecrets,
  resolveDeploymentConfigPath,
  resolveDeploymentSecretsPath,
  resolveLegacyDeploymentConfigPath,
  serializeDeploymentConfig,
} from './file_utils';
import {
  UndecryptableExistingSecretError,
  prepareMergedDeploymentSecrets,
} from './secret_io';
import {
  testDatastoreConnection,
  type DatastoreTestResult,
} from './test_datastore_connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask an IDENTIFIER for "configured?" display: first 6 + last 4. */
function maskSecret(value: string): string {
  if (value.length <= 10) return '••••••••••';
  return `${value.slice(0, 6)} … ${value.slice(-4)}`;
}

/**
 * Keys whose value is an IDENTIFIER (not a credential) and may show a short
 * first6/last4 preview. Everything else (passwords, secretAccessKey) returns
 * presence-only — a partial preview of a lower-entropy DB password would leak
 * usable material to any read-only instance-admin (the read path is NOT gated
 * by the editor allowlist).
 */
const PREVIEWABLE_SECRET_KEYS = new Set<string>([
  'dataStores.convexStorage.accessKeyId',
]);

function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

/** SSRF-gate every host/endpoint a config persists. */
function gateHosts(config: DeploymentConfig): void {
  const ds = config.dataStores;
  if (!ds) return;
  if (ds.knowledgePostgres) {
    checkProviderHostPolicy(
      `http://${ds.knowledgePostgres.host}:${ds.knowledgePostgres.port}`,
    );
  }
  if (ds.appPostgres) {
    checkProviderHostPolicy(
      `http://${ds.appPostgres.host}:${ds.appPostgres.port}`,
    );
  }
  if (ds.convexStorage?.mode === 's3' && ds.convexStorage.endpoint) {
    checkProviderHostPolicy(ds.convexStorage.endpoint);
  }
}

/** Best-effort audit: a successful save must not fail because audit is down. */
async function auditBestEffort(
  ctx: ActionCtx,
  auth: InstanceAdminAuth,
  actionName: string,
): Promise<void> {
  try {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        actorType: 'user',
        action: actionName,
        category: 'security',
        resourceType: 'deployment',
        resourceId: 'deployment',
        resourceName: 'deployment',
        status: 'success',
      },
    );
  } catch (err) {
    console.warn(
      `[deployment] failed to write audit log for ${actionName}`,
      sanitizeError(err),
    );
  }
}

// Single module-level advisory lock — the deployment secrets file is one file,
// and `prepareMergedDeploymentSecrets` is read-modify-write, so concurrent
// saves within this Node process must serialize to avoid clobbering keys.
let secretWriteLock: Promise<unknown> = Promise.resolve();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Read the deployment config + masked secret presence. Gated on
 * instance-admin only (NOT the editor allowlist) so any admin can view the
 * current config read-only even when they are not an editor. `canEdit` tells
 * the UI whether THIS caller may edit (their email is in the allowlist).
 */
/**
 * Read the deployment config, YAML-first: `deployment.yml` is the current
 * form; the retired `deployment.json` stays readable until the next save
 * converts it (the parser accepts both — YAML is a superset of JSON).
 */
async function readDeploymentConfigFile() {
  const current = await readJsonFile(
    resolveDeploymentConfigPath(),
    MAX_FILE_SIZE_BYTES,
    parseDeploymentConfig,
  );
  if (!current.ok && current.error === 'not_found') {
    return await readJsonFile(
      resolveLegacyDeploymentConfigPath(),
      MAX_FILE_SIZE_BYTES,
      parseDeploymentConfig,
    );
  }
  return current;
}

export const readDeploymentConfig = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const auth = await requireInstanceAdmin(ctx);

    const res = await readDeploymentConfigFile();
    let config: DeploymentConfig;
    let hash: string | null;
    if (res.ok) {
      config = res.data;
      hash = res.hash;
    } else if (res.error === 'not_found') {
      config = { version: DEPLOYMENT_CONFIG_VERSION };
      hash = null;
    } else {
      throw new ConvexError({
        code: 'DEPLOYMENT_CONFIG_UNREADABLE',
        message: res.message,
      });
    }

    const secrets: Record<string, { present: boolean; masked?: string }> = {};
    let secretsError: 'encrypted_no_key' | 'unreadable' | undefined;
    try {
      const raw = await decryptSecretsFile(resolveDeploymentSecretsPath());
      const parsed = parseDeploymentSecrets(raw);
      for (const key of DEPLOYMENT_SECRET_KEYS) {
        const val = parsed[key];
        if (!val) {
          secrets[key] = { present: false };
        } else if (PREVIEWABLE_SECRET_KEYS.has(key)) {
          secrets[key] = { present: true, masked: maskSecret(val) };
        } else {
          // Credential: presence only, no substring of the value.
          secrets[key] = { present: true };
        }
      }
    } catch (err) {
      if (!isErrnoCode(err, 'ENOENT')) {
        secretsError =
          err instanceof EncryptedFileWithoutKeyError
            ? 'encrypted_no_key'
            : 'unreadable';
      }
      for (const key of DEPLOYMENT_SECRET_KEYS) {
        secrets[key] ??= { present: false };
      }
    }

    return {
      config,
      hash,
      secrets,
      secretsError,
      canEdit: isDeploymentEditor(auth.email),
      email: auth.email,
    };
  },
});

/**
 * Persist the deployment config. Requires instance-admin + the UI flag.
 * Validates the schema, SSRF-gates hosts/endpoints, and honors an optional
 * optimistic-hash token (`DEPLOYMENT_VERSION_CONFLICT` on mismatch).
 */
export const saveDeploymentConfig = action({
  args: { config: v.any(), expectedHash: v.optional(v.string()) },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const auth = await requireInstanceAdmin(ctx, { write: true });

    const parsed = deploymentConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_DEPLOYMENT_CONFIG',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const config = parsed.data;
    gateHosts(config);

    const configPath = resolveDeploymentConfigPath();
    if (args.expectedHash !== undefined) {
      const existing = await readDeploymentConfigFile();
      const currentHash = existing.ok ? existing.hash : null;
      if (currentHash !== args.expectedHash) {
        throw new ConvexError({
          code: 'DEPLOYMENT_VERSION_CONFLICT',
          message:
            'Deployment config was modified by another operator. Reload to see the latest state, then re-apply your changes.',
        });
      }
    }

    const content = serializeDeploymentConfig(config);
    await atomicWrite(configPath, content);
    // The YAML file is now the source of truth; retire the JSON-era copy so
    // the fallback reader can never resurrect a stale config.
    try {
      await unlink(resolveLegacyDeploymentConfigPath());
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(
          '[deployment] could not remove the retired deployment.json:',
          err,
        );
      }
    }
    await auditBestEffort(ctx, auth, 'deployment_config_saved');
    return { hash: sha256(content) };
  },
});

/**
 * Persist (merge) deployment secrets. Incoming values override existing; an
 * explicit empty string clears a key. Refuses to overwrite an unreadable
 * existing file unless `force`. Requires instance-admin + the UI flag.
 */
export const saveDeploymentSecret = action({
  args: {
    secrets: v.record(v.string(), v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireInstanceAdmin(ctx, { write: true });

    // Reject unknown secret keys at the boundary (defense-in-depth; the merged
    // set is re-validated against the allowlist in prepareMergedDeploymentSecrets).
    const allowed = new Set<string>(DEPLOYMENT_SECRET_KEYS);
    for (const key of Object.keys(args.secrets)) {
      if (!allowed.has(key)) {
        throw new ConvexError({
          code: 'INVALID_DEPLOYMENT_SECRET_KEY',
          message: `Unknown deployment secret key: ${key}`,
        });
      }
    }

    const secretsPath = resolveDeploymentSecretsPath();

    // Serialize concurrent secret writes within this process.
    const prev = secretWriteLock;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    secretWriteLock = prev.then(() => next);
    await prev;

    try {
      let prepared: Awaited<ReturnType<typeof prepareMergedDeploymentSecrets>>;
      try {
        prepared = await prepareMergedDeploymentSecrets(
          secretsPath,
          args.secrets,
          { force: args.force },
        );
      } catch (err) {
        if (err instanceof EncryptedFileWithoutKeyError) {
          throw new ConvexError({
            code: 'DEPLOYMENT_SECRET_REFUSED_OVERWRITE',
            kind: 'encrypted_no_key',
            path: secretsPath,
          });
        }
        if (err instanceof UndecryptableExistingSecretError) {
          throw new ConvexError({
            code: 'DEPLOYMENT_SECRET_REFUSED_OVERWRITE',
            kind: 'undecryptable_existing',
            path: secretsPath,
            reason: err.reason,
          });
        }
        throw err;
      }

      const content = hasSopsKey()
        ? encryptJsonWithSops(prepared.plaintext)
        : prepared.plaintext;
      await atomicWriteSecret(secretsPath, content);
      invalidateSecretsCache(secretsPath);
      await auditBestEffort(
        ctx,
        auth,
        prepared.forced
          ? 'force_overwrite_deployment_secret'
          : 'deployment_secret_saved',
      );
      return null;
    } finally {
      release();
    }
  },
});

/** Read a single stored deployment secret by key (undefined if absent/unreadable). */
async function readStoredSecret(
  key: DeploymentSecretKey,
): Promise<string | undefined> {
  try {
    const raw = await decryptSecretsFile(resolveDeploymentSecretsPath());
    return parseDeploymentSecrets(raw)[key];
  } catch (err) {
    if (!isErrnoCode(err, 'ENOENT')) {
      console.warn(
        `[deployment] could not read stored secret ${key}`,
        sanitizeError(err),
      );
    }
    return undefined;
  }
}

/**
 * Probe a candidate data-store connection before saving. Tests the values in
 * the form, falling back to the stored secret when the secret field is left
 * blank. Postgres targets proxy to the RAG admin endpoint (which also reports
 * pgvector + ParadeDB availability); the S3 target does a HeadBucket on the
 * files bucket. Requires instance-admin + the UI flag (refuses when disabled).
 */
export const testDeploymentConnection = action({
  args: {
    target: v.union(
      v.literal('knowledgePostgres'),
      v.literal('appPostgres'),
      v.literal('convexStorage'),
    ),
    config: v.any(),
    // Only the Postgres targets take a candidate secret to test with; the S3
    // target does a credential-free reachability probe (creds validated at boot).
    password: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireInstanceAdmin(ctx, { write: true });

    if (args.target === 'convexStorage') {
      const parsed = convexStorageSchema.safeParse(args.config);
      if (!parsed.success) {
        return { ok: false, error: 'Invalid storage config' };
      }
      const storage = parsed.data;
      if (storage.mode === 'local') {
        return { ok: true, hint: 'Local storage needs no connection test.' };
      }

      // Dependency-free REACHABILITY check: confirm the bucket endpoint
      // resolves, is reachable, and presents valid TLS. Credentials + bucket
      // access (and the other four use-case buckets) are validated when the
      // deployment restarts — the Convex backend fails loudly on bad S3
      // config at boot — so a pre-save reachability probe is the right scope
      // here and avoids a heavy AWS-SDK dependency. An unauthenticated request
      // to a real bucket returns 200/403/404; only a transport/TLS/DNS error
      // means "unreachable".
      const base = storage.endpoint
        ? storage.endpoint.replace(/\/+$/, '')
        : `https://s3.${storage.region}.amazonaws.com`;
      const url =
        storage.endpoint || storage.forcePathStyle
          ? `${base}/${encodeURIComponent(storage.buckets.files)}`
          : `https://${encodeURIComponent(storage.buckets.files)}.s3.${storage.region}.amazonaws.com`;
      checkProviderHostPolicy(url);
      const t0 = Date.now();
      try {
        const res = await safeFetch(url, { method: 'HEAD', timeoutMs: 8_000 });
        return {
          ok: true,
          latencyMs: Date.now() - t0,
          httpStatus: res.status,
          hint: 'Reachability + TLS only. Credentials, bucket access, and the other buckets are verified when the deployment restarts.',
        };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof SafeFetchError || err instanceof Error
              ? err.message
              : String(err),
        };
      }
    }

    // Postgres targets (knowledgePostgres / appPostgres).
    const parsed = pgConnectionSchema.safeParse(args.config);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid Postgres connection config' };
    }
    const pg = parsed.data;
    checkProviderHostPolicy(`http://${pg.host}:${pg.port}`);

    // The app (Convex metadata) DB connection cannot honor a chosen sslmode at
    // boot (postgres-v5 rejects a `?sslmode=` URL), so its sslMode control is
    // hidden in the UI. Probe with `prefer` — TLS if available, else plaintext —
    // so the test mirrors the driver-default boot behavior instead of
    // certifying an enforced mode the deployment won't actually use.
    const testSslmode = args.target === 'appPostgres' ? 'prefer' : pg.sslmode;

    const password =
      args.password ||
      (await readStoredSecret(`dataStores.${args.target}.password`));

    let data: DatastoreTestResult;
    try {
      // In-process datastore probe (replaces the external RAG
      // `/api/v1/admin/datastore/test-connection`).
      data = await testDatastoreConnection({
        host: pg.host,
        port: pg.port,
        database: pg.database,
        user: pg.user,
        password,
        sslmode: testSslmode,
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
    } else if (
      args.target === 'knowledgePostgres' &&
      data.ok &&
      data.paradedb_available === false
    ) {
      hint =
        'ParadeDB (`pg_search`) is not available — full-text/BM25 hybrid search will degrade to vector-only. Install ParadeDB for full search quality.';
    }

    // The in-process probe returns `null` for absent fields (matching the
    // RAG response shape); normalize to `undefined` for the action's optional
    // return contract (the UI's `ConnTestResult` uses optional, not nullable).
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
 * One-click "Apply & restart": ask the opt-in `controller` sidecar to bounce
 * convex so a saved config takes effect. HMAC-signs the request with the
 * shared `CONTROLLER_TOKEN`. When the controller isn't configured, returns a
 * `configured:false` result so the UI shows the manual command instead.
 * NEVER touches the Docker socket from here — that's the controller's job.
 */
export const requestRestart = action({
  args: { services: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireInstanceAdmin(ctx, { write: true });

    const url = process.env.CONTROLLER_URL;
    const token = process.env.CONTROLLER_TOKEN;
    if (!url || !token) {
      return {
        configured: false,
        ok: false,
        error:
          'The restart controller is not enabled. Restart manually: `docker compose restart convex` (or `tale deploy --services convex`).',
      };
    }

    const services =
      args.services && args.services.length > 0 ? args.services : ['convex'];
    const { createHmac, randomUUID } = await import('node:crypto');
    const body = JSON.stringify({ services, nonce: randomUUID() });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', token)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/restart`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-controller-timestamp': timestamp,
          'x-controller-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const raw = await res.json().catch(() => ({}));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- controller returns arbitrary JSON
      const json = raw as Record<string, unknown>;
      return { configured: true, ok: res.ok && json.ok !== false, ...json };
    } catch (err) {
      return {
        configured: true,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
