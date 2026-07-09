'use node';

/**
 * Per-domain admin sync: refresh one org's config domain from the built-in
 * catalog (`$TALE_CONFIG_BUILTIN_DIR/<domain>/`), on demand from the domain's
 * catalog page. The org-create scaffold copies the catalog once; after that,
 * the only refresh paths were the operator-wide reseed (`tale deploy
 * --override-all`) and the per-app reinstall. This action gives org admins the
 * same override semantics for a single domain — overwrite builtin-named
 * entries, preserve org-authored ones — with a backup of every replaced entry:
 *
 *  - tree domains (agents/workflows): each changed file's previous content is
 *    written to the entry's existing `.history/` trail first, so the standard
 *    history-restore UI can undo the sync per entry. Then the domain is
 *    reseeded with the scaffold's `override:true` per-file overwrite.
 *  - bundle domains (integrations/automations/skills): only bundles that
 *    actually differ are replaced (staging + atomic rename); the previous
 *    bundle is copied to `<domainDir>/.history/<bundle>/<timestamp>/` first.
 *    Untouched bundles keep their internal `.history/` trails. For
 *    `automations` specifically, an installed app's `workflows/` subtree is
 *    write-once (an installed workflow is user-owned/editable — see
 *    `automations/install_fs.ts`'s `isWorkflowShellPath`): a workflow-only
 *    change doesn't count as "the bundle differs", and the replace overlays
 *    the org's existing `workflows/` back onto the fresh copy before the
 *    atomic rename.
 *
 * Post-sync, the same provisioning hooks the org-create flow uses run again:
 * the default-agent/workflow provisioners pick up new `autoInstall` entries,
 * and installed apps whose bundle changed re-run the reinstall pipeline
 * (re-register rows, refresh the resource ledger, reconcile schedules).
 */

import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { getConfigDomain } from '../../lib/shared/config/registry';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import {
  MAX_HISTORY_ENTRIES as AGENT_MAX_HISTORY_ENTRIES,
  resolveHistoryDir as resolveAgentHistoryDir,
} from '../agents/file_utils';
import { invalidateAgentListCache } from '../agents/internal_actions';
import { agentSlugFromFileName, validateAgentSlug } from '../agents/validators';
import {
  ensureOrgResources,
  prepareInstall,
} from '../automations/install_actions';
import { invalidateSkillContextCache } from '../lib/agent_chat/skill_context_cache';
import { resolveDomainDir } from '../lib/config_store/resolvers';
import {
  atomicWrite,
  errnoCode,
  generateHistoryTimestamp,
  pruneHistory,
} from '../lib/file_io';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import {
  MAX_HISTORY_ENTRIES as WORKFLOW_MAX_HISTORY_ENTRIES,
  resolveHistoryDir as resolveWorkflowHistoryDir,
  workflowSlugFromRelativePath,
} from '../workflows/file_utils';
import {
  copyTreeVerbatim,
  pathsOverlap,
  replaceBundleDir,
  seedDomain,
} from './scaffold';

/** The catalog-page domains the sync button covers. */
const SYNCABLE_DOMAINS = [
  'agents',
  'workflows',
  'integrations',
  'automations',
  'skills',
] as const;
type SyncableDomain = (typeof SYNCABLE_DOMAINS)[number];

/** Max preserved backups per bundle under `<domainDir>/.history/<bundle>/`. */
const MAX_BUNDLE_BACKUPS = 10;

/**
 * Recursively list file paths under `dir`, relative POSIX paths. Mirrors the
 * scaffold `copyTree` skip rules (dotfiles/dirs incl. `.history`,
 * `*.secrets.json`, symlinks) so the diff compares exactly the set of files a
 * sync writes — org-side secrets and history trails never count as a
 * difference on their own. Returns [] when the dir is missing.
 */
async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith('.secrets.json')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(path.join(dir, entry.name), rel)));
      continue;
    }
    if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function readFileOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The `.history/` dir for one tree-domain entry, matching what the domain's
 * existing history-restore UI reads. Agents key history by the canonical slug
 * (the file's `slug` field, else the basename); workflows by the flattened
 * relative slug.
 */
function treeEntryHistoryDir(
  domain: 'agents' | 'workflows',
  orgSlug: string,
  relativePath: string,
  previousContent: string,
): string {
  if (domain === 'workflows') {
    return resolveWorkflowHistoryDir(
      orgSlug,
      workflowSlugFromRelativePath(relativePath),
    );
  }
  let slug: string | undefined;
  try {
    const parsed: unknown = JSON.parse(previousContent);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'slug' in parsed &&
      typeof parsed.slug === 'string' &&
      validateAgentSlug(parsed.slug)
    ) {
      slug = parsed.slug;
    }
  } catch {
    // Corrupt JSON still gets a backup — key it by the file basename.
  }
  return resolveAgentHistoryDir(
    orgSlug,
    slug ?? agentSlugFromFileName(relativePath),
  );
}

/**
 * Diff a tree domain (agents/workflows) against the builtin catalog and write
 * a per-entry history backup for every file the override seed will change.
 * Returns the counts for the caller's toast.
 */
async function backupChangedTreeEntries(
  domain: 'agents' | 'workflows',
  sourceDir: string,
  targetDir: string,
  orgSlug: string,
): Promise<{ updated: number; backedUp: number }> {
  const maxEntries =
    domain === 'agents'
      ? AGENT_MAX_HISTORY_ENTRIES
      : WORKFLOW_MAX_HISTORY_ENTRIES;
  let updated = 0;
  let backedUp = 0;
  for (const rel of await listFilesRecursive(sourceDir)) {
    const src = await readFile(path.join(sourceDir, rel));
    const dst = await readFileOrNull(path.join(targetDir, rel));
    if (dst !== null && dst.equals(src)) continue;
    updated++;
    if (dst === null) continue; // new entry, nothing to back up
    const previous = dst.toString('utf-8');
    try {
      const historyDir = treeEntryHistoryDir(domain, orgSlug, rel, previous);
      await mkdir(historyDir, { recursive: true });
      await atomicWrite(
        path.join(historyDir, `${generateHistoryTimestamp()}.json`),
        previous,
      );
      await pruneHistory(historyDir, maxEntries);
      backedUp++;
    } catch (err) {
      // A failed backup must not block the sync of the other entries; the
      // overwrite itself is still recorded in the result counts.
      console.warn(
        `[builtinSync] ${domain}: history backup failed for "${rel}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { updated, backedUp };
}

/** Keep only the most recent `MAX_BUNDLE_BACKUPS` timestamp dirs per bundle. */
async function pruneBundleBackups(bundleHistoryDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(bundleHistoryDir);
  } catch {
    return;
  }
  const sorted = entries.sort();
  const toDelete = sorted.slice(
    0,
    Math.max(0, sorted.length - MAX_BUNDLE_BACKUPS),
  );
  for (const name of toDelete) {
    await rm(path.join(bundleHistoryDir, name), { recursive: true }).catch(
      (err) => {
        if (errnoCode(err) !== 'ENOENT') {
          console.warn('[builtinSync] backup prune failed:', name, err);
        }
      },
    );
  }
}

/**
 * Whether an org bundle differs from its builtin counterpart — i.e. whether a
 * replace would change anything the sync is responsible for. Compares the
 * builtin file set against the org file set (an org-side extra file counts:
 * the replace removes it), then file contents. Org-side `.history/` trails
 * and secrets never count on their own — an otherwise-identical bundle stays
 * untouched and keeps them.
 */
async function bundleDiffers(
  bundleSrc: string,
  bundleDst: string,
): Promise<boolean> {
  const srcFiles = await listFilesRecursive(bundleSrc);
  const dstFiles = await listFilesRecursive(bundleDst);
  if (srcFiles.length !== dstFiles.length) return true;
  const dstSet = new Set(dstFiles);
  for (const rel of srcFiles) {
    if (!dstSet.has(rel)) return true;
    const src = await readFile(path.join(bundleSrc, rel));
    const dst = await readFileOrNull(path.join(bundleDst, rel));
    if (dst === null || !dst.equals(src)) return true;
  }
  return false;
}

/**
 * Diff + backup + replace for a bundle domain (integrations/apps/skills).
 * Only bundles that actually differ are touched, so unchanged bundles keep
 * their internal `.history/` trails. Returns the changed bundle names for the
 * apps post-sync reinstall pass.
 */
async function syncBundleDomain(
  sourceDir: string,
  targetDir: string,
): Promise<{ updated: number; backedUp: number; changedBundles: string[] }> {
  let bundleNames;
  try {
    bundleNames = await readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') {
      return { updated: 0, backedUp: 0, changedBundles: [] };
    }
    throw err;
  }

  let updated = 0;
  let backedUp = 0;
  const changedBundles: string[] = [];
  for (const entry of bundleNames) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const bundleSrc = path.join(sourceDir, entry.name);
    const bundleDst = path.join(targetDir, entry.name);
    if (!(await bundleDiffers(bundleSrc, bundleDst))) {
      continue;
    }

    const hadPrevious =
      (await lstat(bundleDst).catch(() => null))?.isDirectory() ?? false;
    if (hadPrevious) {
      const bundleHistoryDir = path.join(targetDir, '.history', entry.name);
      await copyTreeVerbatim(
        bundleDst,
        path.join(bundleHistoryDir, generateHistoryTimestamp()),
      );
      await pruneBundleBackups(bundleHistoryDir);
      backedUp++;
    }
    await replaceBundleDir(bundleSrc, bundleDst, undefined);
    updated++;
    changedBundles.push(entry.name);
  }
  return { updated, backedUp, changedBundles };
}

export const syncDomainFromBuiltin = action({
  args: {
    organizationId: v.string(),
    domain: v.union(
      v.literal('agents'),
      v.literal('workflows'),
      v.literal('integrations'),
      v.literal('automations'),
      v.literal('skills'),
    ),
  },
  returns: v.object({
    updated: v.number(),
    backedUp: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ updated: number; backedUp: number }> => {
    // Same gate as the app/integration install lifecycle: the sync (re)writes
    // capability-bearing config files on disk.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const domainName: SyncableDomain = args.domain;
    const domain = getConfigDomain(domainName);

    const catalogRoot = process.env.TALE_CONFIG_BUILTIN_DIR;
    if (!catalogRoot || !path.isAbsolute(catalogRoot)) {
      throw new Error(
        'TALE_CONFIG_BUILTIN_DIR is unset or not absolute; the builtin catalog is unavailable',
      );
    }
    const sourceDir = path.join(catalogRoot, domainName);
    const targetDir = resolveDomainDir(domainName, orgSlug);
    if (await pathsOverlap(sourceDir, targetDir)) {
      // Symlink/bind-mount overlap between catalog and data trees — nothing
      // to sync (and replacing would wipe live data).
      return { updated: 0, backedUp: 0 };
    }

    let updated = 0;
    let backedUp = 0;
    let changedBundles: string[] = [];
    if (domain.scaffoldKind === 'bundle') {
      const result = await syncBundleDomain(sourceDir, targetDir);
      updated = result.updated;
      backedUp = result.backedUp;
      changedBundles = result.changedBundles;
    } else {
      const treeDomain = domainName === 'agents' ? 'agents' : 'workflows';
      const result = await backupChangedTreeEntries(
        treeDomain,
        sourceDir,
        targetDir,
        orgSlug,
      );
      updated = result.updated;
      backedUp = result.backedUp;
      if (updated > 0) {
        const seeded = await seedDomain(domain, catalogRoot, orgSlug, true);
        if (!seeded.ok) {
          throw new Error(
            `Sync failed for domain "${domainName}": ${seeded.error ?? 'unknown error'}`,
          );
        }
      }
    }

    // Agents: run the autoInstall provisioner even when no FILE changed — the
    // explicit "Update built-in agents" action doubles as the recovery path
    // for a deleted install ROW. `reinstallMissing` marks the run as
    // operator-consented, so an autoInstall agent whose row was removed is
    // restored (the provisioner's background default never re-provisions
    // behind the org's back).
    if (domainName === 'agents') {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.provision_defaults.syncDefaultAgentInstallations,
        {
          organizationId: args.organizationId,
          orgSlug,
          reinstallMissing: true,
        },
      );
    }

    if (updated === 0) return { updated, backedUp };

    // Post-sync hooks — the same provisioning the org-create flow runs after
    // the scaffold, so new `autoInstall` entries and changed app bundles
    // become live without a second manual step.
    if (domainName === 'agents') {
      invalidateAgentListCache(orgSlug);
    } else if (domainName === 'workflows') {
      await ctx.scheduler.runAfter(
        0,
        internal.workflows.provision_defaults.syncDefaultWorkflowInstallations,
        { organizationId: args.organizationId, orgSlug },
      );
    } else if (domainName === 'skills') {
      // Drop the org's cached skill snapshot so the next chat send rebuilds
      // with the refreshed bundles immediately (same invalidation the skill
      // upload/create/delete paths run).
      invalidateSkillContextCache(orgSlug);
    } else if (domainName === 'automations') {
      // Re-run the reinstall pipeline for installed apps whose bundle changed:
      // re-registers agent/workflow rows with the new hashes, refreshes the
      // resource ledger, and reconciles schedules. Never touches env/secrets.
      //
      // KNOWN GAP (R4): this app-domain refresh BYPASSES the install-override
      // confirmation the public `installAutomation`/`reinstallAutomation` enforce — it calls
      // `ensureOrgResources` directly, so a changed builtin bundle overwrites
      // org-dir edits without a per-file confirmation. The sync is itself an
      // explicit, admin-gated "refresh from builtins" action, which is why
      // this is tolerated rather than fixed here.
      const installed: string[] = await ctx.runQuery(
        internal.automations.install_mutations
          .listAutomationInstallationsInternal,
        { organizationId: args.organizationId },
      );
      const changed = new Set(changedBundles);
      for (const automationSlug of installed) {
        if (!changed.has(automationSlug)) continue;
        try {
          const install = await prepareInstall(
            ctx,
            args.organizationId,
            automationSlug,
          );
          await ensureOrgResources(
            ctx,
            args.organizationId,
            automationSlug,
            install,
          );
        } catch (err) {
          // A single app's re-registration failure must not roll back the
          // file sync of the others; the app page's integrity check still
          // surfaces a broken install with its own reinstall prompt.
          console.warn(
            `[builtinSync] apps: reinstall pipeline failed for "${automationSlug}":`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    return { updated, backedUp };
  },
});
