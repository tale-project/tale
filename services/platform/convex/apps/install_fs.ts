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
 * `scripts/` + `agents/` + `workflows/` all copy into `org/apps/<slug>/` (the
 * SHELL). Agents/workflows are APP-SCOPED — resolved by the composite slug
 * `<app>/<name>` and invisible to the global agent/workflow surfaces by
 * construction, removed wholesale by the shell `rm` on uninstall. Only
 * `integrations/` fans OUT into the org's SHARED `org/integrations/` dir (one
 * credential per org), so only it is recorded in the removal ledger.
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
import { resolveAppDir, resolveCatalogAppDir } from './file_utils';

/**
 * Bundle subdirs that fan OUT into the org's SHARED domain dirs and so need a
 * removal ledger. Only `integrations` qualifies now: `agents` + `workflows`
 * copy UNDER the app's own dir (with the shell) and are removed by the shell
 * `rm` on uninstall, so they need no ledger.
 */
const FANOUT_DOMAINS: Record<string, { allowSubdirs: boolean }> = {
  integrations: { allowSubdirs: true },
};

export interface InstalledResource {
  domain: string;
  /** Path relative to the org domain dir (e.g. `github/connector.ts`). */
  path: string;
  contentHash: string;
}

/**
 * Read + parse the app's manifest from its bundle source (built-in catalog, or
 * the org's own apps dir for a privately-uploaded app — see
 * {@link resolveAppBundleSourceDir}).
 */
export async function readAppBundleManifest(
  orgSlug: string,
  appSlug: string,
): Promise<AppManifest> {
  const sourceDir = await resolveAppBundleSourceDir(orgSlug, appSlug);
  const content = await readFile(path.join(sourceDir, 'app.json'), 'utf-8');
  return appManifestSchema.parse(JSON.parse(content));
}

/**
 * The app's bundle dir in the built-in catalog (read-only source) — the shared
 * resolver in `file_utils`, the single source of truth for both the hub's
 * catalog discovery and this install copy.
 */
function appBundleTemplateDir(appSlug: string): string {
  return resolveCatalogAppDir(appSlug);
}

/** Whether the slug names a first-party app in the built-in catalog. */
export async function appExistsInBuiltinCatalog(
  appSlug: string,
): Promise<boolean> {
  return stat(appBundleTemplateDir(appSlug))
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/**
 * Resolve the directory an app's bundle is installed FROM. A first-party app
 * lives in the built-in catalog; a privately-uploaded app (see
 * `upload_actions.ts`) lives only in the org's own `apps/<slug>/` dir — for it
 * the org dir IS the source. Built-in wins when both exist so a stray org-dir
 * copy can never shadow the first-party bundle. Throws if neither has the app.
 *
 * When the source equals the org app dir, every downstream copy is a no-op: the
 * `pathsOverlap` guards in {@link installAppFiles}/{@link uninstallAppFiles}
 * skip the shell copy (it's already in place) and skip the bundle removal on
 * uninstall (so an uploaded private app stays listed + re-installable).
 */
export async function resolveAppBundleSourceDir(
  orgSlug: string,
  appSlug: string,
): Promise<string> {
  const builtinDir = appBundleTemplateDir(appSlug);
  if (
    await stat(builtinDir)
      .then((s) => s.isDirectory())
      .catch(() => false)
  ) {
    return builtinDir;
  }
  const orgAppDir = resolveAppDir(orgSlug, appSlug);
  const hasManifest = await stat(path.join(orgAppDir, 'app.json'))
    .then((s) => s.isFile())
    .catch(() => false);
  if (hasManifest) return orgAppDir;
  throw new Error(`App "${appSlug}" not found in the catalog`);
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
    // Everything except the fan-out domains (integrations) is shell — including
    // `agents/` + `workflows/`, which are app-scoped and live under the app dir.
    if (skip(name) || name in FANOUT_DOMAINS) continue;
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
  // Built-in catalog for a first-party app, or the org's own apps dir for a
  // privately-uploaded one (throws if the app is in neither).
  const templateDir = await resolveAppBundleSourceDir(orgSlug, appSlug);

  const orgAppDir = resolveAppDir(orgSlug, appSlug);
  // When the source IS the org's app dir (local dev, or a private upload),
  // skip the self-copy — the shell is already in place.
  if (!(await pathsOverlap(templateDir, orgAppDir))) {
    await copyShell(templateDir, orgAppDir);
  }

  const ledger: InstalledResource[] = [];
  for (const [domain, opts] of Object.entries(FANOUT_DOMAINS)) {
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
 * Reverse `installAppFiles`: remove the fanned-out integration files (pruning
 * emptied dirs) via the ledger, then remove the app shell dir. The shell `rm`
 * ALSO takes the app's agents/workflows (+ their `.history`) — they live under
 * the app dir, so they need no ledger entry. The template bundle is never
 * touched (overlap guard), so local dev can reinstall. Org secrets are untouched.
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

  // Removes the shell AND the app-scoped agents/workflows nested under it —
  // EXCEPT when the bundle source IS the org app dir (local dev, or a private
  // upload): then it's the only copy, so keep it (the private app stays listed
  // + re-installable). Fall back to the built-in path if the source can't be
  // resolved, preserving the prod first-party behaviour.
  const orgAppDir = resolveAppDir(orgSlug, appSlug);
  const sourceDir = await resolveAppBundleSourceDir(orgSlug, appSlug).catch(
    () => appBundleTemplateDir(appSlug),
  );
  if (!(await pathsOverlap(orgAppDir, sourceDir))) {
    await rm(orgAppDir, { recursive: true }).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
  }
}

/**
 * Integrity check for the fan-out (integration) ledger: which ledger resources
 * are missing from the org dir (a user deleted them). A non-empty result means
 * the install is broken → reinstall. App agents/workflows aren't in the ledger,
 * so their integrity is checked separately (manifest-driven) in
 * `verifyAppIntegrity`.
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
