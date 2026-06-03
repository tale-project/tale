'use node';

/**
 * Deployment-config file I/O helpers (deployment-SCOPED — no org slug).
 *
 * The single deployment config lives at the config ROOT as
 * `<configRoot>/deployment.json` (+ SOPS sidecar `deployment.secrets.json`).
 * Because the path is one segment (no `<orgSlug>/` prefix) it is intentionally
 * ignored by the per-org config-watcher — this config is consumed by the
 * rag/convex/platform entrypoints AT BOOT, not hot-reloaded.
 */

import type {
  DeploymentConfig,
  DeploymentSecrets,
} from '../../lib/shared/schemas/deployment';
import {
  deploymentConfigSchema,
  deploymentSecretsSchema,
} from '../../lib/shared/schemas/deployment';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
} from '../lib/file_io';

export { sha256 };
export type { DeploymentConfig, DeploymentSecrets };

/** Deployment config is tiny; cap well below the per-org file caps. */
export const MAX_FILE_SIZE_BYTES = 64 * 1024;

export type DeploymentReadResult =
  | { ok: true; config: DeploymentConfig; hash: string }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

export function resolveDeploymentConfigPath(): string {
  return safeJoinWithinDir(getConfigRoot('deployment'), 'deployment.json');
}

export function resolveDeploymentSecretsPath(): string {
  return safeJoinWithinDir(
    getConfigRoot('deployment'),
    'deployment.secrets.json',
  );
}

export function serializeDeploymentConfig(config: DeploymentConfig): string {
  return serializeJson(config);
}

export function parseDeploymentConfig(content: string): DeploymentConfig {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const result = deploymentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid deployment config: ${result.error.message}`);
  }
  return result.data;
}

export function parseDeploymentSecrets(
  data: Record<string, unknown>,
): DeploymentSecrets {
  const result = deploymentSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid deployment secrets: ${result.error.message}`);
  }
  return result.data;
}
