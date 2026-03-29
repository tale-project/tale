'use node';

/**
 * Integration file utilities.
 *
 * Pure helpers for resolving paths, validating slugs, and parsing integration JSON.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import {
  integrationJsonSchema,
  type IntegrationJsonConfig,
} from '../../lib/shared/schemas/integrations';
import { serializeJson, sha256, validateOrgSlug } from '../lib/file_io';

export { sha256 };

/**
 * Integration slug: lowercase alphanumeric + hyphens/underscores, flat (no nesting).
 * Must match the directory name under INTEGRATIONS_DIR.
 */
const INTEGRATION_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
const MAX_SLUG_LENGTH = 64;

export type IntegrationReadResult =
  | { ok: true; config: IntegrationJsonConfig; hash: string }
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

export function validateIntegrationSlug(slug: string): boolean {
  if (slug.length > MAX_SLUG_LENGTH) return false;
  return INTEGRATION_SLUG_REGEX.test(slug);
}

function getBaseDir(): string {
  const dir = process.env.INTEGRATIONS_DIR;
  if (!dir) {
    throw new Error(
      'INTEGRATIONS_DIR environment variable is not set. ' +
        'Set it in .env to the absolute path of your integrations directory ' +
        '(e.g., INTEGRATIONS_DIR=/path/to/tale/examples/integrations).',
    );
  }
  return dir;
}

/**
 * Resolve the integrations directory for an organization.
 * Default org uses the base dir directly.
 * Other orgs use `{baseDir}/@{orgSlug}/`.
 */
export function resolveIntegrationsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const baseDir = getBaseDir();
  if (orgSlug === 'default') {
    return baseDir;
  }
  return path.join(baseDir, `@${orgSlug}`);
}

/**
 * Resolve the directory path for a specific integration.
 */
export function resolveIntegrationDir(orgSlug: string, slug: string): string {
  if (!validateIntegrationSlug(slug)) {
    throw new Error(`Invalid integration slug: ${slug}`);
  }
  const dir = resolveIntegrationsDir(orgSlug);
  const resolved = path.resolve(dir, slug);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${slug}`);
  }
  return resolved;
}

export function resolveConfigPath(orgSlug: string, slug: string): string {
  return path.join(resolveIntegrationDir(orgSlug, slug), 'config.json');
}

export function resolveConnectorPath(orgSlug: string, slug: string): string {
  return path.join(resolveIntegrationDir(orgSlug, slug), 'connector.ts');
}

export function resolveIconPath(orgSlug: string, slug: string): string {
  return path.join(resolveIntegrationDir(orgSlug, slug), 'icon.svg');
}

export function serializeIntegrationJson(
  config: IntegrationJsonConfig,
): string {
  return serializeJson(config);
}

export function parseIntegrationJson(content: string): IntegrationJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = integrationJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid integration config JSON: ${result.error.message}`);
  }
  return result.data;
}

export { MAX_FILE_SIZE_BYTES };
