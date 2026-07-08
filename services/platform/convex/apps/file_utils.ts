'use node';

/**
 * Filesystem resolvers for first-class APPS (`<config>/<org>/apps/<slug>/`).
 * Mirrors the skills resolvers' traversal/symlink guards. An app bundle holds
 * `app.json` (manifest), `views/*.json`, `messages/`, and `scripts/` (the
 * `pack://<app>/scripts/...` assets a workflow's sandbox step references).
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { isValidAppSlug } from '../../lib/shared/schemas/apps';
import {
  getConfigRoot,
  safeJoinWithinDir,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';

export function resolveAppsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('apps'), orgSlug, 'apps');
}

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

/**
 * The built-in app catalog dir (`<builtin>/apps`) — the read-only source of
 * installable apps the Apps hub discovers and `installApp` copies from. The
 * catalog is the generic built-in dir (`TALE_CONFIG_BUILTIN_DIR`), whose
 * children are the domains, so apps live at `<catalog>/apps/<slug>` with no
 * `default`/org level and no fallback. Required: dev/prod/E2E all set the env.
 */
export function resolveCatalogAppsDir(): string {
  const catalogRoot = process.env[BUILTIN_ENV];
  if (!catalogRoot) {
    throw new Error(
      `${BUILTIN_ENV} is not set; cannot resolve the built-in app catalog`,
    );
  }
  return path.join(catalogRoot, 'apps');
}

/** The catalog bundle dir for one app (`<builtin>/apps/<slug>`). */
export function resolveCatalogAppDir(slug: string): string {
  if (!isValidAppSlug(slug)) {
    throw new Error(`Invalid app slug: ${slug}`);
  }
  return path.join(resolveCatalogAppsDir(), slug);
}

/**
 * Slugs of every app BUNDLE present on disk under `org/apps/` (uploaded private
 * apps and installed shells). NOT the install signal — `appInstallations` is
 * authoritative for which apps are live. Used where all bundles must be
 * discovered (e.g. hub listing); agent/workflow pickers must query
 * `listAppInstallationsInternal` instead. A missing `org/apps/` root → `[]`.
 */
export async function listInstalledAppSlugsFromDisk(
  orgSlug: string,
): Promise<string[]> {
  try {
    const entries = await readdir(resolveAppsDir(orgSlug), {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory() && isValidAppSlug(e.name))
      .map((e) => e.name);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

export function resolveAppDir(orgSlug: string, slug: string): string {
  if (!isValidAppSlug(slug)) {
    throw new Error(`Invalid app slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveAppsDir(orgSlug), slug);
}

export function resolveAppManifestPath(orgSlug: string, slug: string): string {
  return path.join(resolveAppDir(orgSlug, slug), 'app.json');
}

function validateAssetRelPath(relPath: string): void {
  if (relPath.length === 0 || relPath.length > 200) {
    throw new Error('Asset path must be 1..200 characters');
  }
  if (relPath.includes('\0')) {
    throw new Error('Asset path must not contain NUL bytes');
  }
  if (path.isAbsolute(relPath)) {
    throw new Error('Asset path must be relative');
  }
  if (/^[A-Za-z]:/.test(relPath)) {
    throw new Error('Asset path must not contain a drive prefix');
  }
  for (const seg of relPath.split(/[\\/]+/)) {
    if (seg === '' || seg === '..') {
      throw new Error('Asset path must not contain `..` or empty segments');
    }
    if (seg.startsWith('.')) {
      throw new Error('Asset path segments must not start with `.`');
    }
  }
}

export function resolveAppAssetPath(
  orgSlug: string,
  slug: string,
  relPath: string,
): string {
  validateAssetRelPath(relPath);
  return safeJoinWithinDir(resolveAppDir(orgSlug, slug), relPath);
}

/** Safe variant: realpath-checks the resolved path stays within the app dir. */
export async function resolveAppAssetPathChecked(
  orgSlug: string,
  slug: string,
  relPath: string,
): Promise<string> {
  const appDir = resolveAppDir(orgSlug, slug);
  const resolved = resolveAppAssetPath(orgSlug, slug, relPath);
  await verifyPathWithinBase(resolved, appDir);
  return resolved;
}
