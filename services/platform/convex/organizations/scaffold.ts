'use node';

/**
 * Scaffold + cleanup per-org filesystem config under the uniform org-first
 * layout (`$TALE_CONFIG_DIR/<orgSlug>/<domain>/...` for every org incl.
 * `default`). Source of seed data is the immutable builtin catalog baked
 * into the convex image at `$TALE_CONFIG_BUILTIN_DIR/default/<domain>/`
 * (set in services/platform/Dockerfile, propagated via the entrypoint's
 * `convex env set` loop). Falls back to the default org's writable dir
 * when the env is unset, so local `bun dev` (no catalog) still works.
 *
 * `scaffoldNewOrganization`:
 *   - org-create path (`override:false`, default): idempotent per-domain
 *     skip if the target dir already has files.
 *   - reseed path (`override:true`, called by `reseedAllOrgsFromBuiltin`):
 *     overwrites builtin-named files in place while always preserving
 *     `*.secrets.json` and `.history/` trails. Per-domain semantics —
 *     flat: per-file atomicWrite; dir-bundle (skills/integrations):
 *     `rm -rf <per-bundle>` then copy bundle; workflows + branding:
 *     per-file overwrite (preserves user-only folders / images);
 *     retention: single-file copy.
 *
 * `cleanupOrgFilesystem` removes the entire `<orgSlug>/` subtree (org is
 * one tree under org-first), guarded by validateOrgSlug + verifyPathWithinBase
 * + an lstat symlink defense (an attacker-placed symlink at the org dir
 * would otherwise be followed by `rm -rf` to arbitrary filesystem
 * locations). Uses a two-phase rename-then-delete so concurrent writers
 * fail with ENOENT rather than racing the recursive delete.
 */

import {
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { resolveAgentsDir } from '../agents/file_utils';
import { resolveBrandingDir } from '../branding/file_utils';
import { resolveIntegrationsDir } from '../integrations/file_utils';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';
import { resolveProvidersDir } from '../providers/file_utils';
import { resolveSkillsDir } from '../skills/file_utils';
import { resolveWorkflowsDir } from '../workflows/file_utils';

type DirResolver = (orgSlug: string) => string;

type Domain = {
  name: string;
  resolve: DirResolver;
  // 'flat' = one file per item, no subdirs in the catalog (agents/providers/branding).
  //   override:true overwrites per-file via atomicWrite; user-added files survive,
  //   secrets + .history at the dir level survive.
  // 'bundle' = per-item directory bundle (skills/integrations). override:true
  //   rm -rf's the per-bundle subdir then copies — wholesale bundle replace.
  //   Dir-level `.history`/secrets at the domain root (siblings of bundles) survive.
  // 'tree' = arbitrary nested files (workflows). override:true per-file overwrite;
  //   user-only folders survive.
  kind: 'flat' | 'bundle' | 'tree';
};

// `default` is the canonical template org in the catalog; the catalog tree
// at `$TALE_CONFIG_BUILTIN_DIR/default/<domain>/` is the source for every
// org including default itself.
const DOMAINS: Domain[] = [
  { name: 'agents', resolve: resolveAgentsDir, kind: 'flat' },
  { name: 'providers', resolve: resolveProvidersDir, kind: 'flat' },
  { name: 'integrations', resolve: resolveIntegrationsDir, kind: 'bundle' },
  { name: 'workflows', resolve: resolveWorkflowsDir, kind: 'tree' },
  { name: 'skills', resolve: resolveSkillsDir, kind: 'bundle' },
  // Branding is logically a tree (branding.json + images/ subdir). Per-file
  // overwrite is correct: catalog overwrites branding.json; uploaded
  // `images/*.png` survive (they're neither secrets nor .history).
  { name: 'branding', resolve: resolveBrandingDir, kind: 'tree' },
];

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

const SKIP_FILE_SUFFIXES = ['.secrets.json'];
const SKIP_DIR_NAMES = new Set(['.history']);

function shouldSkipFile(name: string): boolean {
  return SKIP_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

// atomicWrite leaves `.<basename>.<ts>.<uuid>.tmp` orphans on crash. Those
// shouldn't lock out a retry, but every other entry (including dotfiles
// like `.history/` that agents/workflows write on every edit) means a user
// has been here and we must not overwrite in the non-override path.
function isAtomicWriteTmp(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.tmp');
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some((n) => !isAtomicWriteTmp(n));
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') {
      console.warn('[scaffold.dirHasFiles] readdir failed:', dir, err);
    }
    return false;
  }
}

/**
 * realpath-aware equality / containment check. `path.resolve` only
 * canonicalizes `..`/`.` — it does NOT follow symlinks. A symlinked
 * `TALE_CONFIG_BUILTIN_DIR` (or bind-mount overlap between src/dst)
 * could otherwise produce a copy-onto-self where `rm -rf <bundle>` then
 * copy from the same dir wipes the live data. Use `realpath` on both
 * sides; treat ENOENT on either side as "not yet a symlink concern"
 * and fall back to `path.resolve`.
 */
async function pathsOverlap(a: string, b: string): Promise<boolean> {
  const resolveReal = async (p: string): Promise<string> => {
    try {
      return await realpath(p);
    } catch {
      return path.resolve(p);
    }
  };
  const realA = await resolveReal(a);
  const realB = await resolveReal(b);
  if (realA === realB) return true;
  if (realA.startsWith(realB + path.sep)) return true;
  if (realB.startsWith(realA + path.sep)) return true;
  return false;
}

async function writeFileFromCatalog(src: string, dst: string): Promise<void> {
  const buf = await readFile(src);
  const name = path.basename(src);
  if (
    name.endsWith('.json') ||
    name.endsWith('.ts') ||
    name.endsWith('.svg') ||
    name.endsWith('.md')
  ) {
    await atomicWrite(dst, buf.toString('utf-8'));
  } else {
    await atomicWriteBuffer(dst, buf);
  }
}

/**
 * Recursively copy `sourceDir` → `targetDir`. Skips `.history/`, dotfiles
 * (`.<name>`), `*.secrets.json`, and symlinks at every level. Used by
 * `tree` and (top-level) `bundle` domain seeds.
 *
 * `allowSubdirs=false` (used by flat domains) means: don't recurse into
 * any subdir found in the source. The catalog for flat domains has no
 * subdirs, so a subdir indicates a fallback workspace with leaked
 * cross-tenant content — skip with a warning rather than recurse.
 */
async function copyTree(
  sourceDir: string,
  targetDir: string,
  allowSubdirs = true,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(sourceDir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    throw err;
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (shouldSkipFile(name)) continue;

    const src = path.join(sourceDir, name);
    const dst = path.join(targetDir, name);

    // lstat (not stat) so a symlink in the source is detected and skipped
    // rather than followed. The catalog tracks no symlinks today; this
    // keeps the scaffold from dereferencing if one is ever introduced.
    const info = await lstat(src).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn('[scaffold.copyTree] lstat failed:', src, err);
      }
      return null;
    });
    if (!info) continue;
    if (info.isSymbolicLink()) {
      console.warn('[scaffold.copyTree] skipping symlink:', src);
      continue;
    }

    if (info.isDirectory()) {
      if (!allowSubdirs) {
        console.warn(
          '[scaffold.copyTree] skipping unexpected subdir in flat domain:',
          src,
        );
        continue;
      }
      await copyTree(src, dst, allowSubdirs);
      continue;
    }

    if (!info.isFile()) continue;
    await writeFileFromCatalog(src, dst);
  }
}

/**
 * Seed a single domain for an org. Source is `<catalogRoot>/default/<domain>`
 * (canonical template) when `TALE_CONFIG_BUILTIN_DIR` is set, falling back
 * to `resolve('default')` for local dev. Returns true on success, false on
 * skip/failure.
 */
async function seedDomain(
  domain: Domain,
  catalogRoot: string | undefined,
  orgSlug: string,
  override: boolean,
): Promise<void> {
  const sourceDir = catalogRoot
    ? path.join(catalogRoot, 'default', domain.name)
    : domain.resolve('default');
  const targetDir = domain.resolve(orgSlug);

  if (catalogRoot) {
    // Operator-set catalog path must exist; missing = deploy misconfig
    // (platform/convex image version skew). Surface in logs instead of
    // silent zero-seed.
    const sourceExists = await stat(sourceDir)
      .then(() => true)
      .catch((err) => {
        if (errnoCode(err) === 'ENOENT') {
          console.error(
            `[scaffold] ${domain.name}: ${BUILTIN_ENV}=${catalogRoot} is set but ${sourceDir} does not exist; org "${orgSlug}" will receive zero seed data for this domain`,
          );
        } else {
          console.error(
            `[scaffold] ${domain.name}: stat ${sourceDir} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
        return false;
      });
    if (!sourceExists) return;
  }

  // copy-onto-self guard: realpath-aware. Fires for default-org reseed
  // in the fallback case (catalog env unset, source = target) and for
  // any symlinked overlap between catalog and data trees.
  if (await pathsOverlap(sourceDir, targetDir)) {
    console.warn(
      `[scaffold] ${domain.name}: source and target overlap (${sourceDir} ↔ ${targetDir}); skipping`,
    );
    return;
  }

  if (!override) {
    const alreadyScaffolded = await dirHasFiles(targetDir);
    if (alreadyScaffolded) {
      console.warn(
        `[scaffold] ${domain.name}: target ${targetDir} already has files, skipping (use override:true to reseed)`,
      );
      return;
    }
  }

  try {
    if (domain.kind === 'flat') {
      // Per-file atomicWrite. Overwrites only catalog-named files; user-added
      // files at the same dir survive (e.g., an org's custom agent). Dir-level
      // `.history`/secrets survive (copyTree skips them at the source side,
      // and per-file write doesn't touch siblings).
      await copyTree(sourceDir, targetDir, /* allowSubdirs */ false);
    } else if (domain.kind === 'bundle') {
      // For each catalog bundle subdir, rm -rf the corresponding target
      // bundle (if override) then copy. Domain-root siblings (.history/,
      // *.secrets.json at the domain dir level) survive — we only touch
      // bundle subdirs that exist in the catalog.
      let bundles: string[];
      try {
        bundles = await readdir(sourceDir);
      } catch (err) {
        if (errnoCode(err) === 'ENOENT') return;
        throw err;
      }
      for (const bundleName of bundles) {
        if (bundleName.startsWith('.')) continue;
        if (SKIP_DIR_NAMES.has(bundleName)) continue;
        const bundleSrc = path.join(sourceDir, bundleName);
        const bundleDst = path.join(targetDir, bundleName);
        const info = await lstat(bundleSrc).catch(() => null);
        if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
        if (override) {
          await rm(bundleDst, { recursive: true, force: true });
        }
        await copyTree(bundleSrc, bundleDst, /* allowSubdirs */ true);
      }
    } else {
      // 'tree' — workflows + branding. Per-file overwrite, no rm. User-only
      // subdirs / files survive intact (e.g. an org's custom workflow folder,
      // an uploaded branding/images/logo.png).
      await copyTree(sourceDir, targetDir, /* allowSubdirs */ true);
    }
  } catch (err) {
    console.error(
      `[scaffold] ${domain.name}: copy failed for org "${orgSlug}":`,
      err instanceof Error ? err.message : err,
    );
    // Continue with other domains; partial scaffolding is better than none.
  }
}

/**
 * Retention is one JSON object per org (`<orgSlug>/retention.json`), not a
 * subtree. Special-cased outside the DOMAINS loop.
 */
async function seedRetention(
  catalogRoot: string | undefined,
  orgSlug: string,
  override: boolean,
): Promise<void> {
  const sourceFile = catalogRoot
    ? path.join(catalogRoot, 'default', 'retention.json')
    : path.join(process.env.TALE_CONFIG_DIR ?? '', 'default', 'retention.json');
  const targetFile = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgSlug,
    'retention.json',
  );

  const sourceExists = await stat(sourceFile)
    .then(() => true)
    .catch((err) => {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn('[scaffold] retention: stat failed:', sourceFile, err);
      }
      return false;
    });
  if (!sourceExists) return;

  if (await pathsOverlap(sourceFile, targetFile)) {
    console.warn(`[scaffold] retention: source and target overlap; skipping`);
    return;
  }

  const targetExists = await stat(targetFile)
    .then(() => true)
    .catch(() => false);
  if (targetExists && !override) {
    console.warn(
      `[scaffold] retention: target ${targetFile} exists, skipping (use override:true to reseed)`,
    );
    return;
  }

  try {
    const buf = await readFile(sourceFile);
    await atomicWrite(targetFile, buf.toString('utf-8'));
  } catch (err) {
    console.error(
      `[scaffold] retention: copy failed for org "${orgSlug}":`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Remove a deleted org's entire `<orgSlug>/` subtree under
 * `${TALE_CONFIG_DIR}`. Safety:
 * - TALE_CONFIG_DIR must be set + absolute.
 * - Refuses the literal `default` slug.
 * - Validates the slug via `validateOrgSlug` so a NULL / `..` / cased
 *   slug from a misbehaving caller can't slip through.
 * - `verifyPathWithinBase` enforces strict descendant-of-root containment.
 * - `lstat`-refuses a symlink at the org dir itself: `verifyPathWithinBase`
 *   only realpath's the dirname, so a pre-placed symlink at
 *   `<root>/<orgSlug>` would otherwise be followed by `rm -rf` to
 *   arbitrary filesystem locations.
 * - Two-phase rename-then-delete: rename to a `.deleted-<slug>-<ts>`
 *   sibling first (atomic), then `rm -rf` the renamed path. Concurrent
 *   writers of the original path fail with ENOENT instead of racing
 *   the recursive delete.
 * - Drops `{ force: true }` — `force` masks EACCES/EBUSY silently;
 *   surface errors via the explicit ENOENT branch + error logging.
 * - ENOENT on the org dir is idempotent (nothing to clean up).
 */
export const cleanupOrgFilesystem = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const root = process.env.TALE_CONFIG_DIR;
    if (!root || !path.isAbsolute(root)) {
      console.error(
        '[cleanupOrgFilesystem] TALE_CONFIG_DIR is unset or not absolute; refusing to proceed',
      );
      return null;
    }

    if (args.orgSlug === 'default') {
      console.warn(
        '[cleanupOrgFilesystem] refusing to delete the default org filesystem',
      );
      return null;
    }

    if (!validateOrgSlug(args.orgSlug)) {
      console.warn(
        `[cleanupOrgFilesystem] refusing invalid slug "${args.orgSlug}"`,
      );
      return null;
    }

    const orgDir = path.join(root, args.orgSlug);
    if (path.resolve(orgDir) === path.resolve(root)) {
      console.warn(
        `[cleanupOrgFilesystem] computed orgDir equals root, refusing`,
      );
      return null;
    }

    try {
      await verifyPathWithinBase(orgDir, root);
    } catch (err) {
      console.warn(
        `[cleanupOrgFilesystem] path traversal guard tripped for "${args.orgSlug}":`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    // Symlink hijack defense: verifyPathWithinBase leaves the basename
    // unresolved. If <root>/<orgSlug> is itself a symlink (placed by an
    // attacker or a misconfigured operator), rm -rf would follow it and
    // delete arbitrary filesystem locations. Refuse explicitly here.
    const info = await lstat(orgDir).catch((err) => {
      if (errnoCode(err) === 'ENOENT') return null;
      console.warn(
        `[cleanupOrgFilesystem] lstat failed for "${orgDir}":`,
        err instanceof Error ? err.message : err,
      );
      return null;
    });
    if (!info) return null;
    if (info.isSymbolicLink()) {
      console.error(
        `[cleanupOrgFilesystem] refusing to delete symlinked org dir at "${orgDir}"`,
      );
      return null;
    }

    // Two-phase rename-then-delete. The rename is atomic within a
    // filesystem; any concurrent writer of the original path fails with
    // ENOENT instead of racing the recursive delete.
    const condemned = path.join(root, `.deleted-${args.orgSlug}-${Date.now()}`);
    try {
      await rename(orgDir, condemned);
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return null;
      console.error(
        `[cleanupOrgFilesystem] rename failed for "${orgDir}" → "${condemned}":`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    try {
      await rm(condemned, { recursive: true });
    } catch (err) {
      console.error(
        `[cleanupOrgFilesystem] rm failed for "${condemned}" (org dir was renamed but not fully removed; manual cleanup required):`,
        err instanceof Error ? err.message : err,
      );
    }

    return null;
  },
});

export const scaffoldNewOrganization = internalAction({
  args: {
    orgSlug: v.string(),
    /**
     * When true, overwrite the catalog-named subset of files in each
     * domain, preserving `*.secrets.json` and `.history/`. When false
     * (default), skip per-domain if the target already has visible
     * files (idempotent org-create path).
     */
    override: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    if (!validateOrgSlug(args.orgSlug)) {
      console.warn(
        `[scaffoldNewOrganization] refusing invalid slug "${args.orgSlug}"`,
      );
      return null;
    }

    const catalogRoot = process.env[BUILTIN_ENV];
    const override = args.override ?? false;

    for (const domain of DOMAINS) {
      await seedDomain(domain, catalogRoot, args.orgSlug, override);
    }
    await seedRetention(catalogRoot, args.orgSlug, override);

    return null;
  },
});
