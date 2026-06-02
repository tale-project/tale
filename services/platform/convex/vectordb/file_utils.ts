'use node';

/**
 * Path resolvers + parse helpers for the deployment vector-database config.
 *
 * DEPLOYMENT-LEVEL, not per-org: the config lives at
 * `<configRoot>/.system/vectordb.json` (+ `vectordb.secrets.json`), outside
 * any `<configRoot>/<orgSlug>/` tree. `.system/` can never collide with an
 * org dir — org slugs must start `[a-z0-9]`, so a leading dot is impossible
 * (asserted below). Keep this path in lockstep with the RAG-side
 * `vector_store/config_reader.py` (`DEPLOYMENT_DIR`).
 */

import path from 'node:path';

import type {
  VectorDbConfig,
  VectorDbSecrets,
} from '../../lib/shared/schemas/vectordb';
import {
  vectorDbConfigSchema,
  vectorDbSecretsSchema,
} from '../../lib/shared/schemas/vectordb';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export { sha256 };
export type { VectorDbConfig, VectorDbSecrets };

export const MAX_FILE_SIZE_BYTES = 64 * 1024;

/** Reserved deployment-scoped dir; provably not a valid org slug. */
const DEPLOYMENT_DIR = '.system';
if (validateOrgSlug(DEPLOYMENT_DIR)) {
  throw new Error(
    `Deployment dir "${DEPLOYMENT_DIR}" must not be a valid org slug — it would collide with an org config tree.`,
  );
}

export function resolveVectorDbDir(): string {
  return path.join(getConfigRoot('vectordb'), DEPLOYMENT_DIR);
}

export function resolveVectorDbConfigPath(): string {
  return safeJoinWithinDir(resolveVectorDbDir(), 'vectordb.json');
}

export function resolveVectorDbSecretsPath(): string {
  return safeJoinWithinDir(resolveVectorDbDir(), 'vectordb.secrets.json');
}

export function parseVectorDbConfig(content: string): VectorDbConfig {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const result = vectorDbConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid vector-db config: ${result.error.message}`);
  }
  return result.data;
}

export function parseVectorDbSecrets(
  data: Record<string, unknown>,
): VectorDbSecrets {
  const result = vectorDbSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid vector-db secrets: ${result.error.message}`);
  }
  return result.data;
}

export function serializeVectorDbConfig(config: VectorDbConfig): string {
  return serializeJson(config);
}
