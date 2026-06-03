'use node';

/**
 * Path resolvers + parse helpers for the per-organization vector-database config.
 *
 * PER-ORG, single-file layout (isomorphic to retention `<orgSlug>/retention.json`):
 * the config lives at `<configRoot>/<orgSlug>/vectordb.json` (+ the SOPS-encrypted
 * `vectordb.secrets.json` sidecar). Each org configures its own backend; there is
 * no deployment-wide default — orgs without a config file fall back to built-in
 * pgvector in code. Keep this path in lockstep with the RAG-side
 * `vector_store/config_reader.py` (`load_vectordb_config(org_slug)`) and the
 * config-watcher `SINGLE_FILE_ORG_CONFIGS` list.
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

export function resolveVectorDbDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  return path.join(getConfigRoot('vectordb'), orgSlug);
}

export function resolveVectorDbConfigPath(orgSlug: string): string {
  return safeJoinWithinDir(resolveVectorDbDir(orgSlug), 'vectordb.json');
}

export function resolveVectorDbSecretsPath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveVectorDbDir(orgSlug),
    'vectordb.secrets.json',
  );
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
