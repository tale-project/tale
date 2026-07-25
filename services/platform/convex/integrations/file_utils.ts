'use node';

/**
 * Integration file utilities.
 *
 * Pure helpers for resolving paths, validating slugs, and parsing integration JSON.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import { existsSync } from 'node:fs';
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
 * Compute the next free `<stem>-<n>` slug given a `base` slug and the set of
 * already-taken slugs. Used to mint a fresh, non-colliding slug when
 * duplicating an integration (`imap_smtp` → `imap_smtp-2`) or its bundled
 * automation (`imap-smtp/sync-emails` → `imap-smtp/sync-emails-2`).
 *
 * A base that already ends in `-<n>` is re-normalized so `imap_smtp-2` yields
 * `imap_smtp-3`, never `imap_smtp-2-2`. Appending `-<n>` only mutates a kebab
 * path's final segment, so the same helper serves both the flat integration
 * slug space and the `/`-separated automation slug space. The returned slug is
 * always distinct from `base`; the caller re-validates it against the relevant
 * domain regex (length / shape).
 */
export function deriveNextSlug(
  base: string,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing);
  const match = /^(.*)-(\d+)$/.exec(base);
  const stem = match ? match[1] : base;
  let n = match ? Number(match[2]) + 1 : 2;
  let candidate = `${stem}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}`;
  }
  return candidate;
}

const BUILTIN_DIR_ENV = 'TALE_CONFIG_BUILTIN_DIR';

/**
 * Whether `slug` names a first-party integration in the built-in catalog
 * (`<TALE_CONFIG_BUILTIN_DIR>/integrations/<slug>/config.json`). A builtin is a
 * seeded template that must only be disconnected, never fully deleted (that
 * would take the shared template dir with it). A NON-builtin — a duplicate like
 * `imap_smtp-2`, or an uploaded connector — is an org-owned instance whose dir
 * is safe to delete. Independent of connection state: a never-connected
 * duplicate is just as deletable as one that was connected then disconnected.
 * Fails SAFE — an unset catalog env ⇒ treat as builtin (deletion refused).
 */
export function isBuiltinIntegrationSlug(slug: string): boolean {
  const catalogRoot = process.env[BUILTIN_DIR_ENV];
  if (!catalogRoot) return true;
  return existsSync(
    path.join(catalogRoot, 'integrations', slug, 'config.json'),
  );
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
