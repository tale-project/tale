import { unlink } from 'node:fs/promises';

import type { Sql } from 'postgres';

import type { DeploymentConfig } from '../../../lib/shared/schemas/deployment.ts';
import {
  DEPLOYMENT_CONFIG_VERSION,
  deploymentConfigSchema,
} from '../../../lib/shared/schemas/deployment.ts';
import { decideInstanceAdmin } from '../../core/deployment/auth_policy.ts';
import { isDeploymentEditor } from '../../core/deployment/editors.ts';
import {
  MAX_FILE_SIZE_BYTES,
  parseDeploymentConfig,
  resolveDeploymentConfigPath,
  resolveLegacyDeploymentConfigPath,
  serializeDeploymentConfig,
} from '../../core/deployment/file_utils.ts';
import {
  atomicWrite,
  errnoCode,
  readJsonFile,
  sha256,
} from '../../core/lib/file_io.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * INSTANCE-level deployment settings — the one `<configRoot>/deployment.yml`
 * per deployment (today: the `sandboxRuntime` section the sandbox spawner
 * reads at boot). Not org-scoped. Reads need any org-settings admin; writes
 * additionally require the caller's email in the
 * `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist (the editor gate).
 *
 * Where data lives is NOT configured here: the deployment-default stores are
 * environment-driven and per-organization residency is its own config lane
 * (`domains/knowledge`, `domains/object_storage`). The Convex-era
 * `dataStores` section, its secrets sidecar and its connection probe were
 * saved by the Data residency page but read by no boot path; they are gone
 * (`parseDeploymentConfig` drops a leftover section on read).
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

  return {
    config,
    hash,
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
