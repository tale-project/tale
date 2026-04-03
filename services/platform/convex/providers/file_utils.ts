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
import { serializeJson, sha256, validateOrgSlug } from '../lib/file_io';
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

export function parseProviderJson(content: string): ProviderJson {
  const parsed: unknown = JSON.parse(content);
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

function getBaseDir(): string {
  const dir = process.env.PROVIDERS_DIR;
  if (dir) return dir;
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return path.join(configDir, 'providers');
  throw new Error(
    'Neither TALE_CONFIG_DIR nor PROVIDERS_DIR environment variable is set.',
  );
}

export function resolveProvidersDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  const baseDir = getBaseDir();
  if (orgSlug === 'default') return baseDir;
  return path.join(baseDir, orgSlug);
}

export function resolveProviderFilePath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  const dir = resolveProvidersDir(orgSlug);
  const resolved = path.resolve(dir, `${providerName}.json`);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${providerName}`);
  }
  return resolved;
}

export function resolveProviderSecretsPath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  const dir = resolveProvidersDir(orgSlug);
  const resolved = path.resolve(dir, `${providerName}.secrets.json`);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${providerName}`);
  }
  return resolved;
}

export { MAX_FILE_SIZE_BYTES };
