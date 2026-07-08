'use node';

/**
 * Filesystem half of automation install/uninstall: COPY an automation's bundle resources from
 * the template catalog into the org's config dirs, and remove exactly what was
 * copied. Reuses the scaffold copy primitives (`copyTree` / `writeFileFromCatalog`
 * / `pathsOverlap`) so the same symlink / `.secrets.json` / `.history` guards
 * apply. The org dir is authoritative after install — resolution never falls
 * back to the template; a later-deleted file surfaces as a broken install.
 *
 * Bundle layout (`template/automations/<slug>/`): `automation.json` (or the
 * legacy `app.json` — see `file_utils.ts` DUAL-READ) + `views/` + `messages/` +
 * `scripts/` + `agents/` + `workflows/` all copy into the org's automation
 * dir (the SHELL). Agents/workflows are AUTOMATION-SCOPED — resolved by the composite slug
 * `<automation>/<name>` and invisible to the global agent/workflow surfaces by
 * construction, removed wholesale by the shell `rm` on uninstall. Only the
 * {@link FANOUT_DOMAINS} (`integrations/`, `skills/`) fan OUT into the org's
 * SHARED domain dirs, so only they are recorded in the removal ledger.
 *
 * A reinstall/sync overwrites every shell file from the catalog (the manifest —
 * which carries the inline workflow — plus agents, views, messages, icon, scripts).
 */
import { lstat, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type AutomationManifest,
  automationManifestSchema,
  type BundleManifest,
  bundleManifestSchema,
} from '../../lib/shared/schemas/automations';
import { resolveDomainDir } from '../lib/config_store/resolvers';
import { errnoCode, sha256 } from '../lib/file_io';
import { pathsOverlap, writeFileFromCatalog } from '../organizations/scaffold';
import {
  isBundleDir,
  resolveAutomationDir,
  resolveBundleManifestPath,
  resolveCatalogAutomationDir,
  resolveManifestFilePath,
} from './file_utils';

/**
 * Bundle subdirs that fan OUT into the org's SHARED domain dirs and so need a
 * removal ledger: `integrations` (one credentialed definition per org) and
 * `skills` (skill bundles `<slug>/SKILL.md` + assets, fanned into
 * `org/skills/<slug>/`). `agents` + `workflows` copy UNDER the automation's own dir
 * (with the shell) and are removed by the shell `rm` on uninstall, so they
 * need no ledger.
 */
const FANOUT_DOMAINS: Record<string, { allowSubdirs: boolean }> = {
  integrations: { allowSubdirs: true },
  skills: { allowSubdirs: true },
};

export interface InstalledResource {
  domain: string;
  /** Path relative to the org domain dir (e.g. `github/connector.ts`). */
  path: string;
  contentHash: string;
  /**
   * The file existed on disk BEFORE this automation claimed it (it was not created by
   * this install) — uninstall leaves it in place. Inherited across reinstalls
   * via the prior ledger; absent ⇒ automation-owned.
   */
  adopted?: boolean;
}

/** One file an install will materialize — the unit preflight diffs. */
export interface PlannedFile {
  /**
   * `'automation'` for a SHELL file (copied under `org/automations/<slug>/`), or a fan-out
   * key from {@link FANOUT_DOMAINS} (`integrations`, `skills`).
   */
  domain: string;
  /** Path relative to the domain dir (for `'automation'`: relative to the automation dir). */
  path: string;
  /** Absolute source file in the bundle. */
  src: string;
  /** Absolute destination file in the org config dir. */
  dst: string;
}

/**
 * Read + parse the automation's manifest from its bundle source (built-in catalog, or
 * the org's own automations dir for a privately-uploaded automation — see
 * {@link resolveAutomationBundleSourceDir}). DUAL-READ: accepts either the
 * canonical `automation.json` or the legacy `app.json` (see
 * `file_utils.ts#resolveManifestFilePath`).
 */
export async function readAutomationBundleManifest(
  orgSlug: string,
  automationSlug: string,
): Promise<AutomationManifest> {
  const sourceDir = await resolveAutomationBundleSourceDir(
    orgSlug,
    automationSlug,
  );
  const content = await readFile(resolveManifestFilePath(sourceDir), 'utf-8');
  return automationManifestSchema.parse(JSON.parse(content));
}

/**
 * Read + parse a BUNDLE manifest (`bundle.json`) from its source dir, or `null`
 * when the slug resolves to an ordinary automation (no `bundle.json`) — the
 * installer treats that as "not a bundle". Distinct from
 * {@link readAutomationBundleManifest}: a bundle is parsed by the strict
 * `bundleManifestSchema` (it forbids install-bearing fields).
 */
export async function readBundleManifest(
  orgSlug: string,
  slug: string,
): Promise<BundleManifest | null> {
  const sourceDir = await resolveAutomationBundleSourceDir(orgSlug, slug);
  if (!isBundleDir(sourceDir)) return null;
  const content = await readFile(resolveBundleManifestPath(sourceDir), 'utf-8');
  return bundleManifestSchema.parse(JSON.parse(content));
}

/**
 * Read whichever manifest a slug's source dir carries — a {@link BundleManifest}
 * (`bundle.json`, strict schema) or an {@link AutomationManifest}
 * (`automation.json`) — for read paths that may hit either (the assistant's
 * manifest/summary reads). Use {@link manifestDeclaresBundle} to narrow.
 */
export async function readAutomationOrBundleManifest(
  orgSlug: string,
  slug: string,
): Promise<AutomationManifest | BundleManifest> {
  const sourceDir = await resolveAutomationBundleSourceDir(orgSlug, slug);
  if (isBundleDir(sourceDir)) {
    const content = await readFile(
      resolveBundleManifestPath(sourceDir),
      'utf-8',
    );
    return bundleManifestSchema.parse(JSON.parse(content));
  }
  const content = await readFile(resolveManifestFilePath(sourceDir), 'utf-8');
  return automationManifestSchema.parse(JSON.parse(content));
}

/**
 * The automation's bundle dir in the built-in catalog (read-only source) — the shared
 * resolver in `file_utils`, the single source of truth for both the hub's
 * catalog discovery and this install copy.
 */
function automationBundleTemplateDir(automationSlug: string): string {
  return resolveCatalogAutomationDir(automationSlug);
}

/** Whether the slug names a first-party automation in the built-in catalog. */
export async function automationExistsInBuiltinCatalog(
  automationSlug: string,
): Promise<boolean> {
  return stat(automationBundleTemplateDir(automationSlug))
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/**
 * Resolve the directory an automation's bundle is installed FROM. A first-party automation
 * lives in the built-in catalog; a privately-uploaded automation (see
 * `upload_actions.ts`) lives only in the org's own `automations/<slug>/` dir — for it
 * the org dir IS the source. Built-in wins when both exist so a stray org-dir
 * copy can never shadow the first-party bundle. Throws if neither has the automation.
 *
 * When the source equals the org automation dir, every downstream copy is a no-op: the
 * `pathsOverlap` guards in {@link installAutomationFiles}/{@link uninstallAutomationFiles}
 * skip the shell copy (it's already in place) and skip the bundle removal on
 * uninstall (so an uploaded private automation stays listed + re-installable).
 */
export async function resolveAutomationBundleSourceDir(
  orgSlug: string,
  automationSlug: string,
): Promise<string> {
  const builtinDir = automationBundleTemplateDir(automationSlug);
  if (
    await stat(builtinDir)
      .then((s) => s.isDirectory())
      .catch(() => false)
  ) {
    return builtinDir;
  }
  const orgAutomationDir = resolveAutomationDir(orgSlug, automationSlug);
  const hasManifest = await stat(resolveManifestFilePath(orgAutomationDir))
    .then((s) => s.isFile())
    .catch(() => false);
  if (hasManifest) return orgAutomationDir;
  throw new Error(`Automation "${automationSlug}" not found in the catalog`);
}

function skip(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.secrets.json');
}

/** Recursively collect a subtree's files as {@link PlannedFile}s. */
async function planSubtree(
  srcDir: string,
  dstDir: string,
  domain: string,
  allowSubdirs: boolean,
  plan: PlannedFile[],
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
        await planSubtree(src, dst, domain, true, plan, relPath);
      }
      continue;
    }
    if (!info.isFile()) continue;
    plan.push({ domain, path: relPath, src, dst });
  }
}

/**
 * The exact file set installing this automation would materialize — the SHELL files
 * (domain `'automation'`) plus every fan-out file — applying the same guards the copy
 * applies: `skip()` (dotfiles + `*.secrets.json`), symlink skip, the
 * {@link FANOUT_DOMAINS} split, and the `pathsOverlap` short-circuit (when the
 * bundle source IS the org automation dir — a private upload — the shell entries are
 * omitted: the self-copy is a no-op). {@link installAutomationFiles} CONSUMES this
 * plan, so the preflight diff and the install can never diverge.
 */
export async function planAutomationFiles(
  orgSlug: string,
  automationSlug: string,
): Promise<PlannedFile[]> {
  // Built-in catalog for a first-party automation, or the org's own automations dir for a
  // privately-uploaded one (throws if the automation is in neither).
  const templateDir = await resolveAutomationBundleSourceDir(
    orgSlug,
    automationSlug,
  );
  const orgAutomationDir = resolveAutomationDir(orgSlug, automationSlug);
  const plan: PlannedFile[] = [];

  // When the source IS the org's automation dir (local dev, or a private upload),
  // skip the self-copy — the shell is already in place.
  if (!(await pathsOverlap(templateDir, orgAutomationDir))) {
    const entries = await readdir(templateDir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      // Everything except the fan-out domains is shell — including `agents/` +
      // `workflows/`, which are automation-scoped and live under the automation dir.
      if (skip(name) || name in FANOUT_DOMAINS) continue;
      const src = path.join(templateDir, name);
      const dst = path.join(orgAutomationDir, name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await planSubtree(src, dst, 'automation', true, plan, name);
      } else if (entry.isFile()) {
        plan.push({ domain: 'automation', path: name, src, dst });
      }
    }
  }

  for (const [domain, opts] of Object.entries(FANOUT_DOMAINS)) {
    await planSubtree(
      path.join(templateDir, domain),
      resolveDomainDir(domain, orgSlug),
      domain,
      opts.allowSubdirs,
      plan,
    );
  }
  return plan;
}

/**
 * Materialize an automation into the org: copy the shell + fan resources into domain
 * dirs, consuming {@link planAutomationFiles} (one walk shared with the preflight
 * diff). Returns the ledger of copied files (for the install record +
 * uninstall). Throws if the automation is absent from the catalog.
 *
 * `previousResources` is the automation's PRIOR ledger (the existing install row's
 * `resources`, on reinstall) — it carries adoption forward: a fan-out entry
 * already in the prior ledger inherits its `adopted` flag; an entry with no
 * prior claim whose destination ALREADY EXISTS (identical or not) is marked
 * `adopted: true`, so uninstall later leaves the user's pre-existing file in
 * place.
 */
export async function installAutomationFiles(
  orgSlug: string,
  automationSlug: string,
  previousResources?: InstalledResource[],
): Promise<{ resources: InstalledResource[] }> {
  const plan = await planAutomationFiles(orgSlug, automationSlug);
  const prior = new Map(
    (previousResources ?? []).map((r) => [`${r.domain}:${r.path}`, r]),
  );

  const ledger: InstalledResource[] = [];
  for (const file of plan) {
    if (file.domain === 'automation') {
      // Shell files (the manifest with its inline workflow, agents, views,
      // messages, icon, scripts) overwrite on every install/reinstall/sync pass.
      await writeFileFromCatalog(file.src, file.dst);
      continue;
    }
    // Fan-out entry: settle adoption BEFORE the copy overwrites the evidence.
    const priorEntry = prior.get(`${file.domain}:${file.path}`);
    let adopted: boolean;
    if (priorEntry) {
      adopted = priorEntry.adopted === true;
    } else {
      adopted = await stat(file.dst)
        .then((s) => s.isFile())
        .catch(() => false);
    }
    const content = await readFile(file.src, 'utf-8');
    await writeFileFromCatalog(file.src, file.dst);
    ledger.push({
      domain: file.domain,
      path: file.path,
      contentHash: sha256(content),
      ...(adopted ? { adopted: true } : {}),
    });
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
 * Reverse `installAutomationFiles`: remove the fanned-out files (pruning emptied
 * dirs) via the ledger, then remove the automation shell dir. The shell `rm` ALSO
 * takes the automation's agents/workflows (+ their `.history`) — they live under the
 * automation dir, so they need no ledger entry. ADOPTED resources (files that existed
 * before the automation claimed them — see {@link installAutomationFiles}) are left in
 * place. The template bundle is never touched (overlap guard), so local dev
 * can reinstall. Org secrets are untouched.
 */
export async function uninstallAutomationFiles(
  orgSlug: string,
  automationSlug: string,
  resources: InstalledResource[],
): Promise<void> {
  for (const res of resources) {
    // An adopted file predates the automation's claim — uninstall must not take it.
    if (res.adopted === true) continue;
    const domainDir = resolveDomainDir(res.domain, orgSlug);
    const target = path.join(domainDir, res.path);
    await rm(target).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
    await pruneEmptyDirs(path.dirname(target), domainDir);
  }

  // Removes the shell AND the automation-scoped agents/workflows nested under it —
  // EXCEPT when the bundle source IS the org automation dir (local dev, or a private
  // upload): then it's the only copy, so keep it (the private automation stays listed
  // + re-installable). Fall back to the built-in path if the source can't be
  // resolved, preserving the prod first-party behaviour.
  const orgAutomationDir = resolveAutomationDir(orgSlug, automationSlug);
  const sourceDir = await resolveAutomationBundleSourceDir(
    orgSlug,
    automationSlug,
  ).catch(() => automationBundleTemplateDir(automationSlug));
  if (!(await pathsOverlap(orgAutomationDir, sourceDir))) {
    await rm(orgAutomationDir, { recursive: true }).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
  }
}

/**
 * Integrity check for the fan-out (integration) ledger: which ledger resources
 * are missing from the org dir (a user deleted them). A non-empty result means
 * the install is broken → reinstall. Automation agents/workflows aren't in the ledger,
 * so their integrity is checked separately (manifest-driven) in
 * `verifyAutomationIntegrity`.
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
