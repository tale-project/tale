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

/**
 * Slugs of the apps installed in this org, by scanning `org/apps/` subdirectories.
 * The on-disk bundle is the source of truth for which app owns a resource, so the
 * global agent/workflow lists use this to know which app dirs to also scan and
 * tag. A missing `org/apps/` root means no installed apps.
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
