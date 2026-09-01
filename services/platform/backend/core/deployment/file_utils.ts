'use node';

/**
 * Deployment-config file I/O helpers (deployment-SCOPED — no org slug).
 *
 * The single deployment config lives at the config ROOT as
 * `<configRoot>/deployment.yml` (+ SOPS sidecar `deployment.secrets.json`;
 * the retired `deployment.json` stays readable until the next save converts
 * it).
 * Because the path is one segment (no `<orgSlug>/` prefix) it is intentionally
 * ignored by the per-org config-watcher — this config is consumed by the
 * rag/convex/platform entrypoints AT BOOT, not hot-reloaded.
 */

import {
  parseYamlOrThrow,
  stringifyYaml,
} from '../../../lib/shared/config/yaml';
import type {
  DeploymentConfig,
  DeploymentSecrets,
} from '../../../lib/shared/schemas/deployment';
import {
  deploymentConfigSchema,
  deploymentSecretsSchema,
} from '../../../lib/shared/schemas/deployment';
import { getConfigRoot, safeJoinWithinDir, sha256 } from '../lib/file_io';

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
  return safeJoinWithinDir(getConfigRoot('deployment'), 'deployment.yml');
}

/** The retired JSON form — read as a fallback, deleted on the next save. */
export function resolveLegacyDeploymentConfigPath(): string {
  return safeJoinWithinDir(getConfigRoot('deployment'), 'deployment.json');
}

export function resolveDeploymentSecretsPath(): string {
  return safeJoinWithinDir(
    getConfigRoot('deployment'),
    'deployment.secrets.json',
  );
}

export function serializeDeploymentConfig(config: DeploymentConfig): string {
  return stringifyYaml(config);
}

export function parseDeploymentConfig(content: string): DeploymentConfig {
  // YAML is a superset of JSON, so one parser reads both the current .yml
  // form and the retired .json fallback.
  const parsed = parseYamlOrThrow(content);
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

/** Mask an IDENTIFIER for "configured?" display: first 6 + last 4. */
export function maskDeploymentSecret(value: string): string {
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
export const PREVIEWABLE_DEPLOYMENT_SECRET_KEYS = new Set<string>([
  'dataStores.convexStorage.accessKeyId',
]);
