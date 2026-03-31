'use node';

/**
 * Branding JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing branding JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import {
  brandingJsonSchema,
  type BrandingJsonConfig,
} from '../../lib/shared/schemas/branding';
import { serializeJson, sha256, validateOrgSlug } from '../lib/file_io';

export type { BrandingJsonConfig };

export { sha256 };

const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB
const MAX_HISTORY_ENTRIES = 10;
const BRANDING_FILE_NAME = 'branding.json';

export type BrandingReadResult =
  | { ok: true; config: BrandingJsonConfig; hash: string }
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

function getBaseDir(): string {
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return path.join(configDir, 'branding');
  throw new Error(
    'TALE_CONFIG_DIR environment variable is not set. ' +
      'Set TALE_CONFIG_DIR in .env to the root config directory ' +
      '(e.g., TALE_CONFIG_DIR=/path/to/tale/examples).',
  );
}

export function resolveBrandingDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const baseDir = getBaseDir();
  if (orgSlug === 'default') {
    return baseDir;
  }
  return path.join(baseDir, orgSlug);
}

export function resolveBrandingFilePath(orgSlug: string): string {
  const dir = resolveBrandingDir(orgSlug);
  const resolved = path.resolve(dir, BRANDING_FILE_NAME);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

export function resolveHistoryDir(orgSlug: string): string {
  return path.join(resolveBrandingDir(orgSlug), '.history', 'branding');
}

export function serializeBrandingJson(config: BrandingJsonConfig): string {
  return serializeJson(config);
}

export function parseBrandingJson(content: string): BrandingJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = brandingJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid branding JSON: ${result.error.message}`);
  }
  return result.data;
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
