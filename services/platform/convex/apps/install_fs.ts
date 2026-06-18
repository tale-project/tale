'use node';

/**
 * Filesystem half of app install/uninstall: COPY an app's bundle resources from
 * the template catalog into the org's config dirs, and remove exactly what was
 * copied. Reuses the scaffold copy primitives (`copyTree` / `writeFileFromCatalog`
 * / `pathsOverlap`) so the same symlink / `.secrets.json` / `.history` guards
 * apply. The org dir is authoritative after install — resolution never falls
 * back to the template; a later-deleted file surfaces as a broken install.
 *
 * Bundle layout (`template/apps/<slug>/`): `app.json` + `views/` + `messages/` +
 * `scripts/` are the SHELL (copied into `org/apps/<slug>/`); `agents/`,
 * `workflows/`, `integrations/` are the app-owned RESOURCES, fanned out into the
 * org's domain dirs (`org/agents/` …) so slug resolution finds them as usual.
 */
import { lstat, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type AppManifest,
  appManifestSchema,
} from '../../lib/shared/schemas/apps';
import { resolveDomainDir } from '../lib/config_store/resolvers';
import { errnoCode, sha256 } from '../lib/file_io';
import {
  copyTree,
  pathsOverlap,
  writeFileFromCatalog,
} from '../organizations/scaffold';
import { resolveAppDir } from './file_utils';

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

/** Domain subdirs of an app bundle that fan OUT into the org's domain dirs.
 *  `agents` = flat, `workflows` = tree (nested slugs), `integrations` = bundle. */
const RESOURCE_DOMAINS: Record<string, { allowSubdirs: boolean }> = {
  agents: { allowSubdirs: false },
  workflows: { allowSubdirs: true },
  integrations: { allowSubdirs: true },
};

export interface InstalledResource {
  domain: string;
  /** Path relative to the org domain dir (e.g. `issue-desk/desk-process.json`). */
  path: string;
  contentHash: string;
}

/** Read + parse the app's manifest from the template catalog. */
export async function readAppBundleManifest(
  appSlug: string,
): Promise<AppManifest> {
  const manifestPath = path.join(appBundleTemplateDir(appSlug), 'app.json');
  const content = await readFile(manifestPath, 'utf-8');
  return appManifestSchema.parse(JSON.parse(content));
}

/** The app's bundle dir in the shared template catalog (read-only source). */
function appBundleTemplateDir(appSlug: string): string {
  const catalogRoot = process.env[BUILTIN_ENV];
  return catalogRoot
    ? path.join(catalogRoot, 'default', 'apps', appSlug)
    : // Local dev (no baked catalog): the `default` org's writable bundle.
      resolveAppDir('default', appSlug);
}

function skip(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.secrets.json');
}

/** Copy a bundle resource subtree into a domain dir, recording every file. */
async function recordingCopy(
  srcDir: string,
  dstDir: string,
  domain: string,
  allowSubdirs: boolean,
  ledger: InstalledResource[],
  rel = '',
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    throw err;
  }
  for (const name of entries) {
    if (skip(name)) continue;
    const src = path.join(srcDir, name);
    const dst = path.join(dstDir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    const info = await lstat(src);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      if (allowSubdirs) {
        await recordingCopy(src, dst, domain, true, ledger, relPath);
      }
      continue;
    }
    if (!info.isFile()) continue;
    const content = await readFile(src, 'utf-8');
    await writeFileFromCatalog(src, dst);
    ledger.push({ domain, path: relPath, contentHash: sha256(content) });
  }
}

/** Copy the app SHELL (everything that is not a resource domain) into the org. */
async function copyShell(
  templateDir: string,
  orgAppDir: string,
): Promise<void> {
  const entries = await readdir(templateDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (skip(name) || name in RESOURCE_DOMAINS) continue;
    const src = path.join(templateDir, name);
    const dst = path.join(orgAppDir, name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await copyTree(src, dst, /* allowSubdirs */ true);
    else if (entry.isFile()) await writeFileFromCatalog(src, dst);
  }
}

/**
 * Materialize an app into the org: copy the shell + fan resources into domain
 * dirs. Returns the ledger of copied files (for the install record + uninstall).
 * Throws if the app is absent from the catalog.
 */
export async function installAppFiles(
  orgSlug: string,
  appSlug: string,
): Promise<{ resources: InstalledResource[] }> {
  const templateDir = appBundleTemplateDir(appSlug);
  const exists = await stat(templateDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!exists) {
    throw new Error(`App "${appSlug}" not found in the catalog`);
  }

  const orgAppDir = resolveAppDir(orgSlug, appSlug);
  // In local dev the bundle IS the org's app dir — skip the self-copy.
  if (!(await pathsOverlap(templateDir, orgAppDir))) {
    await copyShell(templateDir, orgAppDir);
  }

  const ledger: InstalledResource[] = [];
  for (const [domain, opts] of Object.entries(RESOURCE_DOMAINS)) {
    await recordingCopy(
      path.join(templateDir, domain),
      resolveDomainDir(domain, orgSlug),
      domain,
      opts.allowSubdirs,
      ledger,
    );
  }
  return { resources: ledger };
}

/** Prune now-empty dirs from `dir` upward, never past (or including) `stopAt`. */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  let cur = dir;
  while (cur !== stopAt && cur.startsWith(stopAt + path.sep)) {
    let remaining: string[];
    try {
      remaining = await readdir(cur);
    } catch {
      break;
    }
    if (remaining.length > 0) break;
    await rm(cur, { recursive: true }).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
    cur = path.dirname(cur);
  }
}

/**
 * Reverse `installAppFiles`: remove every copied resource file (pruning emptied
 * dirs) and the app shell. The template bundle is never touched (overlap guard),
 * so local dev can reinstall. Org secrets / `.history` are untouched.
 */
export async function uninstallAppFiles(
  orgSlug: string,
  appSlug: string,
  resources: InstalledResource[],
): Promise<void> {
  for (const res of resources) {
    const domainDir = resolveDomainDir(res.domain, orgSlug);
    const target = path.join(domainDir, res.path);
    await rm(target).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
    await pruneEmptyDirs(path.dirname(target), domainDir);
  }

  const orgAppDir = resolveAppDir(orgSlug, appSlug);
  const templateDir = appBundleTemplateDir(appSlug);
  if (!(await pathsOverlap(orgAppDir, templateDir))) {
    await rm(orgAppDir, { recursive: true }).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
  }
}

/**
 * Integrity check: which ledger resources are missing from the org dir (a user
 * deleted them). A non-empty result means the install is broken → reinstall.
 */
export async function findMissingResources(
  orgSlug: string,
  resources: InstalledResource[],
): Promise<InstalledResource[]> {
  const missing: InstalledResource[] = [];
  for (const res of resources) {
    const target = path.join(resolveDomainDir(res.domain, orgSlug), res.path);
    const present = await stat(target)
      .then(() => true)
      .catch(() => false);
    if (!present) missing.push(res);
  }
  return missing;
}
