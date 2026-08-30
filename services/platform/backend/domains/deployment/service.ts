import { unlink } from 'node:fs/promises';

import type { Sql } from 'postgres';

import { decideInstanceAdmin } from '../../../convex/deployment/auth_policy.ts';
import { isDeploymentEditor } from '../../../convex/deployment/editors.ts';
import {
  MAX_FILE_SIZE_BYTES,
  PREVIEWABLE_DEPLOYMENT_SECRET_KEYS,
  maskDeploymentSecret,
  parseDeploymentConfig,
  parseDeploymentSecrets,
  resolveDeploymentConfigPath,
  resolveDeploymentSecretsPath,
  resolveLegacyDeploymentConfigPath,
  serializeDeploymentConfig,
} from '../../../convex/deployment/file_utils.ts';
import {
  UndecryptableExistingSecretError,
  prepareMergedDeploymentSecrets,
} from '../../../convex/deployment/secret_io.ts';
import { testDatastoreConnection } from '../../../convex/deployment/test_datastore_connection.ts';
import {
  atomicWrite,
  atomicWriteSecret,
  errnoCode,
  readJsonFile,
  sha256,
} from '../../../convex/lib/file_io.ts';
import { checkProviderHostPolicy } from '../../../convex/lib/http/host_policy.ts';
import {
  SafeFetchError,
  safeFetch,
} from '../../../convex/lib/http/safe_fetch.ts';
import {
  EncryptedFileWithoutKeyError,
  decryptSecretsFile,
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../../convex/lib/sops.ts';
import { sanitizeError } from '../../../convex/lib/utils/sanitize_secrets.ts';
import type {
  DeploymentConfig,
  DeploymentSecretKey,
} from '../../../lib/shared/schemas/deployment.ts';
import {
  DEPLOYMENT_CONFIG_VERSION,
  DEPLOYMENT_SECRET_KEYS,
  convexStorageSchema,
  deploymentConfigSchema,
  pgConnectionSchema,
} from '../../../lib/shared/schemas/deployment.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * INSTANCE-level deployment settings — the pg port of the 0.4
 * `deployment/file_actions` handlers, re-orchestrated over the SAME pure
 * helpers (file_utils/secret_io/sops/test_datastore_connection reused
 * whole). Not org-scoped: one `<configRoot>/deployment.yml` (+ SOPS
 * secrets sidecar) per deployment. Reads need any org-settings admin;
 * writes additionally require the caller's email in the
 * `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist (the 0.4 editor gate).
 */
export class DeploymentError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 409 | 500;
  readonly data: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 409 | 500 = 400,
    data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DeploymentError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export interface InstanceAdminAuth {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
}

/** The 0.4 `requireInstanceAdmin` twin over the pg Better Auth tables. */
export async function requireInstanceAdmin(
  sql: Sql,
  user: { id: string; email: string },
  options: { write?: boolean } = {},
): Promise<InstanceAdminAuth> {
  const members = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member"
    WHERE "userId" = ${user.id}
    LIMIT 50
  `;
  const decision = decideInstanceAdmin({
    email: user.email,
    members,
    write: options.write === true,
  });
  if (!decision.ok) {
    throw new DeploymentError(
      decision.code,
      decision.code === 'FORBIDDEN_DEPLOYMENT_EDITOR'
        ? 'Your account is not in the deployment editor allowlist.'
        : 'Deployment settings require an organization admin.',
      403,
    );
  }
  return {
    userId: user.id,
    email: user.email,
    organizationId: decision.adminMember.organizationId,
    role: decision.adminMember.role,
  };
}

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

async function auditBestEffort(
  sql: Sql,
  auth: InstanceAdminAuth,
  actionName: string,
): Promise<void> {
  try {
    await sql.begin((tx) =>
      createAuditLog(tx, {
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
      }),
    );
  } catch (err) {
    console.warn(
      `[deployment] failed to write audit log for ${actionName}`,
      sanitizeError(err),
    );
  }
}

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

export interface DeploymentConfigView {
  config: DeploymentConfig;
  hash: string | null;
  secrets: Record<string, { present: boolean; masked?: string }>;
  secretsError?: 'encrypted_no_key' | 'unreadable';
  canEdit: boolean;
  email: string;
}

export async function readDeploymentConfigView(
  auth: InstanceAdminAuth,
): Promise<DeploymentConfigView> {
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
    throw new DeploymentError('DEPLOYMENT_CONFIG_UNREADABLE', res.message, 500);
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
      } else if (PREVIEWABLE_DEPLOYMENT_SECRET_KEYS.has(key)) {
        secrets[key] = { present: true, masked: maskDeploymentSecret(val) };
      } else {
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
    ...(secretsError !== undefined ? { secretsError } : {}),
    canEdit: isDeploymentEditor(auth.email),
    email: auth.email,
  };
}

export async function saveDeploymentConfig(
  sql: Sql,
  auth: InstanceAdminAuth,
  args: { config: unknown; expectedHash?: string },
): Promise<{ hash: string }> {
  const parsed = deploymentConfigSchema.safeParse(args.config);
  if (!parsed.success) {
    throw new DeploymentError(
      'INVALID_DEPLOYMENT_CONFIG',
      'Invalid deployment config',
      400,
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    );
  }
  const config = parsed.data;
  gateHosts(config);

  const configPath = resolveDeploymentConfigPath();
  if (args.expectedHash !== undefined) {
    const existing = await readDeploymentConfigFile();
    const currentHash = existing.ok ? existing.hash : null;
    if (currentHash !== args.expectedHash) {
      throw new DeploymentError(
        'DEPLOYMENT_VERSION_CONFLICT',
        'Deployment config was modified by another operator. Reload to see the latest state, then re-apply your changes.',
        409,
      );
    }
  }

  const content = serializeDeploymentConfig(config);
  await atomicWrite(configPath, content);
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
  await auditBestEffort(sql, auth, 'deployment_config_saved');
  return { hash: sha256(content) };
}

// One in-process advisory lock — the secrets file is read-modify-write.
let secretWriteLock: Promise<unknown> = Promise.resolve();

export async function saveDeploymentSecret(
  sql: Sql,
  auth: InstanceAdminAuth,
  args: { secrets: Record<string, string>; force?: boolean },
): Promise<void> {
  const allowed = new Set<string>(DEPLOYMENT_SECRET_KEYS);
  for (const key of Object.keys(args.secrets)) {
    if (!allowed.has(key)) {
      throw new DeploymentError(
        'INVALID_DEPLOYMENT_SECRET_KEY',
        `Unknown deployment secret key: ${key}`,
      );
    }
  }

  const secretsPath = resolveDeploymentSecretsPath();
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
        throw new DeploymentError(
          'DEPLOYMENT_SECRET_REFUSED_OVERWRITE',
          'The existing secrets file is encrypted and no key is available.',
          409,
          { kind: 'encrypted_no_key', path: secretsPath },
        );
      }
      if (err instanceof UndecryptableExistingSecretError) {
        throw new DeploymentError(
          'DEPLOYMENT_SECRET_REFUSED_OVERWRITE',
          'The existing secrets file cannot be decrypted.',
          409,
          {
            kind: 'undecryptable_existing',
            path: secretsPath,
            reason: err.reason,
          },
        );
      }
      throw err;
    }

    const content = hasSopsKey()
      ? encryptJsonWithSops(prepared.plaintext)
      : prepared.plaintext;
    await atomicWriteSecret(secretsPath, content);
    invalidateSecretsCache(secretsPath);
    await auditBestEffort(
      sql,
      auth,
      prepared.forced
        ? 'force_overwrite_deployment_secret'
        : 'deployment_secret_saved',
    );
  } finally {
    release();
  }
}

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

export type DeploymentTestTarget =
  | 'knowledgePostgres'
  | 'appPostgres'
  | 'convexStorage';

/** The 0.4 pre-save connection probe, re-orchestrated (same semantics). */
export async function testDeploymentConnection(args: {
  target: DeploymentTestTarget;
  config: unknown;
  password?: string;
}): Promise<Record<string, unknown>> {
  if (args.target === 'convexStorage') {
    const parsed = convexStorageSchema.safeParse(args.config);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid storage config' };
    }
    const storage = parsed.data;
    if (storage.mode === 'local') {
      return { ok: true, hint: 'Local storage needs no connection test.' };
    }
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

  const parsed = pgConnectionSchema.safeParse(args.config);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid Postgres connection config' };
  }
  const pg = parsed.data;
  checkProviderHostPolicy(`http://${pg.host}:${pg.port}`);
  const testSslmode = args.target === 'appPostgres' ? 'prefer' : pg.sslmode;
  const password =
    args.password ||
    (await readStoredSecret(`dataStores.${args.target}.password`));

  let data: Awaited<ReturnType<typeof testDatastoreConnection>>;
  try {
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

  return {
    ok: data.ok,
    latencyMs: data.latency_ms ?? undefined,
    version: data.version ?? undefined,
    vectorAvailable: data.vector_available ?? undefined,
    paradedbAvailable: data.paradedb_available ?? undefined,
    error: data.error ?? undefined,
    ...(hint !== undefined ? { hint } : {}),
  };
}
