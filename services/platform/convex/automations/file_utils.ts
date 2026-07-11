'use node';

/**
 * Filesystem resolvers for first-class AUTOMATIONS
 * (`<config>/<org>/automations/<slug>/`). Mirrors the skills resolvers'
 * traversal/symlink guards. A bundle holds `automation.json` (manifest),
 * `views/*.json`, `messages/`, and `scripts/` (the `pack://<app>/scripts/...`
 * assets a workflow's sandbox step references).
 *
 * A bundle dir carries exactly one manifest: a BUNDLE's `bundle.json` (an
 * aggregator of member automations) or a single automation's
 * `automation.json` (inline workflow); {@link isBundleDir} keys the schema
 * choice on which one is present.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AUTOMATION_MANIFEST_FILENAME,
  automationDisplayFolder,
  type AutomationManifestI18n,
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

const DOMAIN_DIR = 'automations';

export function resolveAutomationsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot(DOMAIN_DIR), orgSlug, DOMAIN_DIR);
}

/**
 * Resolve the manifest file within an already-located bundle dir. Prefers a
 * BUNDLE's `bundle.json` (an aggregator, parsed by `bundleManifestSchema`) over
 * an automation's `automation.json`. Callers that must distinguish a bundle
 * from an automation use {@link isBundleDir} (the presence of `bundle.json`)
 * before choosing a schema; this resolver only locates whichever manifest is
 * on disk (e.g. for an existence check or a folder read).
 */
export function resolveManifestFilePath(bundleDir: string): string {
  const bundle = path.join(bundleDir, BUNDLE_MANIFEST_FILENAME);
  if (existsSync(bundle)) return bundle;
  return path.join(bundleDir, AUTOMATION_MANIFEST_FILENAME);
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
 * `<catalog>/automations/<slug>` with no `default`/org level and no fallback.
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

/** An installed automation's self-translated display text — {@link readInstalledAutomationDisplays}. */
export interface InstalledAutomationDisplay {
  name: string;
  description?: string;
  /** Per-locale overrides; resolve via `resolveAutomationLocale`/
   *  `useAutomationDisplay`, never index this directly. */
  i18n?: AutomationManifestI18n;
}

/**
 * Display name/description/i18n per installed automation (automationSlug →
 * display), read from each automation's ORG-DIR manifest (the authoritative
 * copy after install) — the same tolerant read/fallback shape as
 * {@link readInstalledAutomationFolders} (a missing or malformed manifest
 * falls back to the automation slug as `name`, no description). Backs the
 * global workflow list's automation-owner enrichment
 * (`workflows/file_actions.ts#listWorkflows`) so an automation-owned
 * workflow's binding-picker entry can show the AUTOMATION's self-translated
 * name/description instead of its own slug-derived one.
 */
export async function readInstalledAutomationDisplays(
  orgSlug: string,
  automationSlugs: readonly string[],
): Promise<Map<string, InstalledAutomationDisplay>> {
  const displays = new Map<string, InstalledAutomationDisplay>();
  await Promise.all(
    automationSlugs.map(async (automationSlug) => {
      let display: InstalledAutomationDisplay = { name: automationSlug };
      try {
        const content = await readFile(
          resolveAutomationManifestPath(orgSlug, automationSlug),
          'utf-8',
        );
        const parsed = automationManifestSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          display = {
            name: parsed.data.name,
            description: parsed.data.description,
            i18n: parsed.data.i18n,
          };
        }
      } catch (err) {
        console.warn(
          `[automations.readInstalledAutomationDisplays] falling back to slug for "${automationSlug}":`,
          err instanceof Error ? err.message : err,
        );
      }
      displays.set(automationSlug, display);
    }),
  );
  return displays;
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
