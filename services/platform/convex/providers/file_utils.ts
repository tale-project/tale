'use node';

import path from 'node:path';

import type {
  ProviderJson,
  ProviderSecrets,
} from '../../lib/shared/schemas/providers';
import {
  providerJsonSchema,
  providerSecretsSchema,
} from '../../lib/shared/schemas/providers';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';
import { validateProviderName } from './validators';

export { sha256, validateProviderName };
export type { ProviderJson, ProviderSecrets };

const MAX_FILE_SIZE_BYTES = 256 * 1024;

export type ProviderReadResult =
  | { ok: true; config: ProviderJson; hash: string }
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

export function providerNameFromFileName(fileName: string): string {
  return path.basename(fileName, '.json');
}

export function serializeProviderJson(config: ProviderJson): string {
  return serializeJson(config);
}

/**
 * Migrate legacy per-model `default: boolean` to provider-level `defaults` map.
 * Mutates the raw JSON object in place before Zod validation.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- operating on raw JSON before Zod validation
function migrateModelDefaults(data: Record<string, unknown>): void {
  const models = data.models;
  if (!Array.isArray(models)) return;
  if (data.defaults !== undefined) return;

  const defaults: Record<string, string> = {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON models before validation
  for (const model of models as Record<string, unknown>[]) {
    if (model.default === true) {
      const tags = model.tags;
      const id = model.id;
      if (Array.isArray(tags) && typeof id === 'string') {
        for (const tag of tags) {
          if (typeof tag === 'string' && !(tag in defaults)) {
            defaults[tag] = id;
          }
        }
      }
    }
    delete model.default;
  }

  if (Object.keys(defaults).length > 0) {
    data.defaults = defaults;
  }
}

export function parseProviderJson(content: string): ProviderJson {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
  const parsed = JSON.parse(content) as Record<string, unknown>;
  migrateModelDefaults(parsed);
  const result = providerJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid provider JSON: ${result.error.message}`);
  }
  return result.data;
}

export function parseProviderSecrets(
  data: Record<string, unknown>,
): ProviderSecrets {
  const result = providerSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid provider secrets: ${result.error.message}`);
  }
  return result.data;
}

export function resolveProvidersDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  return path.join(getConfigRoot('providers'), orgSlug, 'providers');
}

export function resolveProviderFilePath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  return safeJoinWithinDir(
    resolveProvidersDir(orgSlug),
    `${providerName}.json`,
  );
}

export function resolveProviderSecretsPath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  return safeJoinWithinDir(
    resolveProvidersDir(orgSlug),
    `${providerName}.secrets.json`,
  );
}

export { MAX_FILE_SIZE_BYTES };
