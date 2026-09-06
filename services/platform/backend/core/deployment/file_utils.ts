'use node';

/**
 * Deployment-config file I/O helpers (deployment-SCOPED — no org slug).
 *
 * The single deployment config lives at the config ROOT as
 * `<configRoot>/deployment.yml` (the retired `deployment.json` stays readable
 * until the next save converts it). Because the path is one segment (no
 * `<orgSlug>/` prefix) it is intentionally ignored by the per-org
 * config-watcher — this config is consumed by the sandbox spawner AT BOOT,
 * not hot-reloaded.
 */

import {
  parseYamlOrThrow,
  stringifyYaml,
} from '../../../lib/shared/config/yaml';
import type { DeploymentConfig } from '../../../lib/shared/schemas/deployment';
import {
  RETIRED_DEPLOYMENT_SECTIONS,
  deploymentConfigSchema,
} from '../../../lib/shared/schemas/deployment';
import { getConfigRoot, safeJoinWithinDir, sha256 } from '../lib/file_io';

export { sha256 };
export type { DeploymentConfig };

/** Deployment config is tiny; cap well below the per-org file caps. */
export const MAX_FILE_SIZE_BYTES = 64 * 1024;

export function resolveDeploymentConfigPath(): string {
  return safeJoinWithinDir(getConfigRoot('deployment'), 'deployment.yml');
}

/** The retired JSON form — read as a fallback, deleted on the next save. */
export function resolveLegacyDeploymentConfigPath(): string {
  return safeJoinWithinDir(getConfigRoot('deployment'), 'deployment.json');
}

export function serializeDeploymentConfig(config: DeploymentConfig): string {
  return stringifyYaml(config);
}

/**
 * Parse a deployment config file. YAML is a superset of JSON, so one parser
 * reads both the current .yml form and the retired .json fallback.
 *
 * A retired section (`dataStores`, saved by the Convex-era Data residency
 * page and read by nothing since) is DROPPED with a warning rather than
 * failing the read: an operator's older file must keep parsing, and the next
 * save rewrites it without the section. Any other unknown key still fails
 * closed — the schema is strict.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseDeploymentConfig(content: string): DeploymentConfig {
  const parsed: unknown = parseYamlOrThrow(content);
  let candidate: unknown = parsed;
  if (isPlainRecord(parsed)) {
    const stripped: Record<string, unknown> = { ...parsed };
    for (const section of RETIRED_DEPLOYMENT_SECTIONS) {
      if (section in stripped) {
        console.warn(
          `[deployment] ignoring the retired "${section}" section of the deployment config — where data lives is set by the environment (DATABASE_URL, KNOWLEDGE_DATABASE_URL, OBJECT_STORE_*) and per organization under Settings > Data residency; the section is dropped on the next save.`,
        );
        delete stripped[section];
      }
    }
    candidate = stripped;
  }
  const result = deploymentConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(`Invalid deployment config: ${result.error.message}`);
  }
  return result.data;
}
