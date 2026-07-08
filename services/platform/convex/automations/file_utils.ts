'use node';

/**
 * Filesystem resolvers for first-class AUTOMATIONS
 * (`<config>/<org>/automations/<slug>/`). Mirrors the skills resolvers'
 * traversal/symlink guards. A bundle holds `automation.json` (manifest),
 * `views/*.json`, `messages/`, and `scripts/` (the `pack://<app>/scripts/...`
 * assets a workflow's sandbox step references).
 *
 * DUAL-READ (zero customer fs-tree migration): the config-domain dir was
 * `apps` and the manifest filename was `app.json` before the Automations
 * rename; both are read-compatible so an already-installed org keeps working
 * with no data migration. `resolveAutomationsDir` prefers the new
 * `<org>/automations/` dir but falls back to the legacy `<org>/apps/` dir
 * when only that exists on disk (an org scaffolded before this shipped never
 * gets an `automations/` dir created out-of-band). `resolveManifestFilePath`
 * prefers `automation.json` but falls back to `app.json` PER BUNDLE — so a
 * mix (some bundles installed before the rename, some after, in the SAME org
 * dir) resolves correctly file by file. Every WRITE (install/upload) emits
 * only the canonical new names; only READS dual-accept the legacy ones.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  APP_MANIFEST_FILENAME,
  AUTOMATION_MANIFEST_FILENAME,
  automationDisplayFolder,
  automationManifestSchema,
  BUNDLE_MANIFEST_FILENAME,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import {
  getConfigRoot,
  safeJoinWithinDir,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';

/** Legacy config-domain dir name — see the file header's DUAL-READ note. */
const LEGACY_DOMAIN_DIR = 'apps';
const DOMAIN_DIR = 'automations';

export function resolveAutomationsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const root = getConfigRoot(DOMAIN_DIR);
  const canonical = path.join(root, orgSlug, DOMAIN_DIR);
  if (existsSync(canonical)) return canonical;
  // Fall back to the legacy `apps/` dir only for an un-migrated org that still
  // has one on disk; a fresh org (neither dir exists) resolves to the canonical
  // `automations/` dir, so a scaffold/install writes there — matching the
  // "prefers the new dir" DUAL-READ contract in this file's header.
  const legacy = path.join(root, orgSlug, LEGACY_DOMAIN_DIR);
  if (existsSync(legacy)) return legacy;
  return canonical;
}

/**
 * Resolve the manifest file within an already-located bundle dir. Prefers a
 * BUNDLE's `bundle.json` (an aggregator, parsed by `bundleManifestSchema`), then
 * an automation's `automation.json`, then the legacy `app.json` (DUAL-READ, see
 * the file header). Callers that must distinguish a bundle from an automation
 * use {@link isBundleDir} (the presence of `bundle.json`) before choosing a
 * schema; this resolver only locates whichever manifest is on disk (e.g. for an
 * existence check or a folder read).
 */
export function resolveManifestFilePath(bundleDir: string): string {
  const bundle = path.join(bundleDir, BUNDLE_MANIFEST_FILENAME);
  if (existsSync(bundle)) return bundle;
  const canonical = path.join(bundleDir, AUTOMATION_MANIFEST_FILENAME);
  if (existsSync(canonical)) return canonical;
  return path.join(bundleDir, APP_MANIFEST_FILENAME);
}

/**
 * Whether an already-located dir is a BUNDLE (ships {@link BUNDLE_MANIFEST_FILENAME})
 * rather than an ordinary automation ({@link AUTOMATION_MANIFEST_FILENAME}). The
 * loaders/installers key on this to pick `bundleManifestSchema` vs
 * `automationManifestSchema`.
 */
export function isBundleDir(bundleDir: string): boolean {
  return existsSync(path.join(bundleDir, BUNDLE_MANIFEST_FILENAME));
}

/** The absolute `bundle.json` path within a bundle dir. */
export function resolveBundleManifestPath(bundleDir: string): string {
  return path.join(bundleDir, BUNDLE_MANIFEST_FILENAME);
}

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

/**
 * The built-in automation catalog dir (`<builtin>/automations`) — the read-only
 * source of installable automations the Automations catalog discovers and `installAutomation`
 * copies from. The catalog is the generic built-in dir
 * (`TALE_CONFIG_BUILTIN_DIR`), whose children are the domains, so automations live at
 * `<catalog>/automations/<slug>` with no `default`/org level and no fallback
 * (the catalog is redeployed fresh with every release, so it carries no
 * legacy state — no dual-read here, unlike the per-org dir/manifest below).
 * Required: dev/prod/E2E all set the env.
 */
export function resolveCatalogAutomationsDir(): string {
  const catalogRoot = process.env[BUILTIN_ENV];
  if (!catalogRoot) {
    throw new Error(
      `${BUILTIN_ENV} is not set; cannot resolve the built-in automation catalog`,
    );
  }
  return path.join(catalogRoot, DOMAIN_DIR);
}

/** The catalog bundle dir for one automation (`<builtin>/automations/<slug>`). */
export function resolveCatalogAutomationDir(slug: string): string {
  if (!isValidAutomationSlug(slug)) {
    throw new Error(`Invalid automation slug: ${slug}`);
  }
  return path.join(resolveCatalogAutomationsDir(), slug);
}

/**
 * Slugs of the automations installed in this org, by scanning the org's automations
 * dir subdirectories (`resolveAutomationsDir` — new or legacy, see the file
 * header). The on-disk bundle is the source of truth for which automation owns a
 * resource, so the global agent/workflow lists use this to know which automation
 * dirs to also scan and tag. A missing dir means no installed automations.
 */
export async function listInstalledAutomationSlugsFromDisk(
  orgSlug: string,
): Promise<string[]> {
  try {
    const entries = await readdir(resolveAutomationsDir(orgSlug), {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory() && isValidAutomationSlug(e.name))
      .map((e) => e.name);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Display folder per installed automation (automationSlug → folder), read from each automation's
 * ORG-DIR manifest (the authoritative copy after install). Tolerant by design
 * — a missing or malformed manifest falls back to the automation slug, exactly the
 * grouping the lists rendered before manifests declared folders — so a broken
 * manifest can never break the global agent/workflow lists.
 */
export async function readInstalledAutomationFolders(
  orgSlug: string,
  automationSlugs: readonly string[],
): Promise<Map<string, string>> {
  const folders = new Map<string, string>();
  await Promise.all(
    automationSlugs.map(async (automationSlug) => {
      let folder = automationSlug;
      try {
        const content = await readFile(
          resolveAutomationManifestPath(orgSlug, automationSlug),
          'utf-8',
        );
        const parsed = automationManifestSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          folder = automationDisplayFolder(parsed.data, automationSlug);
        }
      } catch (err) {
        console.warn(
          `[automations.readInstalledAutomationFolders] falling back to slug for "${automationSlug}":`,
          err instanceof Error ? err.message : err,
        );
      }
      folders.set(automationSlug, folder);
    }),
  );
  return folders;
}

export function resolveAutomationDir(orgSlug: string, slug: string): string {
  if (!isValidAutomationSlug(slug)) {
    throw new Error(`Invalid automation slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveAutomationsDir(orgSlug), slug);
}

export function resolveAutomationManifestPath(
  orgSlug: string,
  slug: string,
): string {
  return resolveManifestFilePath(resolveAutomationDir(orgSlug, slug));
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

export function resolveAutomationAssetPath(
  orgSlug: string,
  slug: string,
  relPath: string,
): string {
  validateAssetRelPath(relPath);
  return safeJoinWithinDir(resolveAutomationDir(orgSlug, slug), relPath);
}

/** Safe variant: realpath-checks the resolved path stays within the automation dir. */
export async function resolveAutomationAssetPathChecked(
  orgSlug: string,
  slug: string,
  relPath: string,
): Promise<string> {
  const automationDir = resolveAutomationDir(orgSlug, slug);
  const resolved = resolveAutomationAssetPath(orgSlug, slug, relPath);
  await verifyPathWithinBase(resolved, automationDir);
  return resolved;
}
