'use node';

/**
 * Integration file utilities.
 *
 * Pure helpers for resolving paths, validating slugs, and parsing integration JSON.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  integrationJsonSchema,
  type IntegrationJsonConfig,
} from '../../lib/shared/schemas/integrations';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export { sha256 };

/**
 * Integration slug: lowercase alphanumeric + hyphens/underscores, flat (no nesting).
 * Must match the directory name under `${TALE_CONFIG_DIR}/<orgSlug>/integrations/`.
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

/**
 * Resolve the integrations directory for an organization. Org-first:
 * `${TALE_CONFIG_DIR}/<orgSlug>/integrations/`.
 */
export function resolveIntegrationsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('integrations'), orgSlug, 'integrations');
}

/**
 * Resolve the directory path for a specific integration.
 */
export function resolveIntegrationDir(orgSlug: string, slug: string): string {
  if (!validateIntegrationSlug(slug)) {
    throw new Error(`Invalid integration slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveIntegrationsDir(orgSlug), slug);
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
    throw new Error(
      zodErrorMessage('Invalid integration config JSON', result.error),
    );
  }
  return result.data;
}

export { MAX_FILE_SIZE_BYTES };
