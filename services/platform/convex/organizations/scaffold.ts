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
 *     flat: per-file atomicWrite (agents/providers/prompts/governance —
 *     governance also carries the `retention.json` bounds catalog as a
 *     flat file); dir-bundle (skills/integrations): `rm -rf <per-bundle>`
 *     then copy bundle; workflows + branding: per-file overwrite
 *     (preserves user-only folders / images).
 *
 * `cleanupOrgFilesystem` removes the entire `<orgSlug>/` subtree (org is
 * one tree under org-first), guarded by validateOrgSlug + verifyPathWithinBase
 * + an lstat symlink defense (an attacker-placed symlink at the org dir
 * would otherwise be followed by `rm -rf` to arbitrary filesystem
 * locations). Uses a two-phase rename-then-delete so concurrent writers
 * fail with ENOENT rather than racing the recursive delete.
 */

import { randomUUID } from 'node:crypto';
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

import {
  CONFIG_DOMAINS,
  type ConfigDomain,
} from '../../lib/shared/config/registry';
import { internalAction } from '../_generated/server';
import { resolveDomainDir } from '../lib/config_store/resolvers';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';

export type DomainResult = {
  domain: string;
  ok: boolean;
  error?: string;
};

// The set of domains to seed comes from the single config-domain registry
// (`lib/shared/config/registry.ts`); their on-disk dirs are resolved via the
// `'use node'` Layer-B resolver map (`lib/config_store/resolvers.ts`). `default`
// is the canonical template org in the catalog; the catalog tree at
// `$TALE_CONFIG_BUILTIN_DIR/default/<domain>/` is the source for every org
// including default itself. Copy semantics per `domain.scaffoldKind`:
//   - 'flat'   = one file per item, no subdirs (agents/providers/prompts/
//     governance). override:true overwrites per-file via atomicWrite; user-added
//     files survive, secrets + .history at the dir level survive. (Governance
//     also carries the `retention.json` bounds catalog + `*.secrets.json`
//     sidecars + `sso/` subdir, which flat-mode copyTree skips.)
//   - 'bundle' = per-item directory bundle (skills/integrations). override:true
//     stages + atomic-renames per bundle; domain-root .history/secrets survive.
//   - 'tree'   = arbitrary nested files (workflows + branding images).
//     override:true per-file overwrite; user-only folders / uploaded images survive.

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

const SKIP_FILE_SUFFIXES = ['.secrets.json'];
const SKIP_DIR_NAMES = new Set(['.history']);

function shouldSkipFile(name: string): boolean {
  return SKIP_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

// atomicWrite leaves `.<basename>.<ts>.<uuid>.tmp` orphans on crash. Bundle-
// mode scaffolds (this file) and skills uploads (skills/file_actions.ts)
// stage into `<basename>.staging-<8hex>` / `<basename>.replacing-<8hex>`
// dirs that are atomic-renamed onto the target. None of these are user-
// authored content, so a leftover from a crash must not (a) lock out a
// retry by making `dirHasFiles` return true and (b) make `override:false`
// skip the whole domain indefinitely.
const STAGING_SUFFIX_RE = /\.(staging|replacing)-[a-f0-9]{8}$/;
function isTransientArtifact(name: string): boolean {
  if (name.startsWith('.') && name.endsWith('.tmp')) return true;
  return STAGING_SUFFIX_RE.test(name);
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some((n) => !isTransientArtifact(n));
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
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn('[scaffold.pathsOverlap] realpath failed:', p, err);
      }
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
 * to `resolve('default')` for local dev.
 *
 * Returns `{ok:true}` on success (including the legitimate
 * "already scaffolded, skipped" case) and `{ok:false, error}` on
 * real failure so the handler can surface or aggregate. Per-domain
 * errors are also logged here for operator visibility.
 */
async function seedDomain(
  domain: ConfigDomain,
  catalogRoot: string | undefined,
  orgSlug: string,
  override: boolean,
): Promise<DomainResult> {
  const sourceDir = catalogRoot
    ? path.join(catalogRoot, 'default', domain.name)
    : resolveDomainDir(domain.name, 'default');
  const targetDir = resolveDomainDir(domain.name, orgSlug);

  if (catalogRoot) {
    // Operator-set catalog path must exist; missing = deploy misconfig
    // (platform/convex image version skew). Surface in logs AND return
    // an error so reseed-all-orgs can fail loudly.
    let statErr: unknown;
    const sourceExists = await stat(sourceDir)
      .then(() => true)
      .catch((err) => {
        statErr = err;
        return false;
      });
    if (!sourceExists) {
      const msg =
        errnoCode(statErr) === 'ENOENT'
          ? `${BUILTIN_ENV}=${catalogRoot} is set but ${sourceDir} does not exist`
          : `stat ${sourceDir} failed: ${statErr instanceof Error ? statErr.message : String(statErr)}`;
      console.error(`[scaffold] ${domain.name}: ${msg}`);
      return { domain: domain.name, ok: false, error: msg };
    }
  }

  // copy-onto-self guard: realpath-aware. Fires for default-org reseed
  // in the fallback case (catalog env unset, source = target) and for
  // any symlinked overlap between catalog and data trees.
  if (await pathsOverlap(sourceDir, targetDir)) {
    console.warn(
      `[scaffold] ${domain.name}: source and target overlap (${sourceDir} ↔ ${targetDir}); skipping`,
    );
    return { domain: domain.name, ok: true };
  }

  if (!override) {
    const alreadyScaffolded = await dirHasFiles(targetDir);
    if (alreadyScaffolded) {
      console.warn(
        `[scaffold] ${domain.name}: target ${targetDir} already has files, skipping (use override:true to reseed)`,
      );
      return { domain: domain.name, ok: true };
    }
  }

  try {
    if (domain.scaffoldKind === 'flat') {
      // Per-file atomicWrite. Overwrites only catalog-named files; user-added
      // files at the same dir survive (e.g., an org's custom agent). Dir-level
      // `.history`/secrets survive (copyTree skips them at the source side,
      // and per-file write doesn't touch siblings).
      await copyTree(sourceDir, targetDir, /* allowSubdirs */ false);
    } else if (domain.scaffoldKind === 'bundle') {
      // For each catalog bundle subdir, rm -rf the corresponding target
      // bundle (if override) then copy. Domain-root siblings (.history/,
      // *.secrets.json at the domain dir level) survive — we only touch
      // bundle subdirs that exist in the catalog.
      let bundles: string[];
      try {
        bundles = await readdir(sourceDir);
      } catch (err) {
        if (errnoCode(err) === 'ENOENT')
          return { domain: domain.name, ok: true };
        throw err;
      }
      for (const bundleName of bundles) {
        if (bundleName.startsWith('.')) continue;
        if (SKIP_DIR_NAMES.has(bundleName)) continue;
        const bundleSrc = path.join(sourceDir, bundleName);
        const bundleDst = path.join(targetDir, bundleName);
        const info = await lstat(bundleSrc).catch((err) => {
          if (errnoCode(err) !== 'ENOENT') {
            console.warn(
              `[scaffold] ${domain.name}: lstat ${bundleSrc} failed:`,
              err,
            );
          }
          return null;
        });
        if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
        if (override) {
          // Write into a sibling staging dir then atomic-rename onto the
          // target. Eliminates the "rm before copy" window where an
          // interrupt would leave an empty bundle on disk. `force` dropped
          // so EACCES / EBUSY surface as real errors. The cleanup-on-exit
          // path below also drops the staging dir to avoid leakage.
          const staging = `${bundleDst}.staging-${randomUUID().slice(0, 8)}`;
          try {
            await copyTree(bundleSrc, staging, /* allowSubdirs */ true);
            // Best-effort old-dir removal before rename. If the old dir
            // exists and is non-empty, `rename` will fail on most platforms
            // — surface that.
            await rm(bundleDst, { recursive: true }).catch((err) => {
              if (errnoCode(err) !== 'ENOENT') throw err;
            });
            await rename(staging, bundleDst);
          } catch (err) {
            // If anything went wrong, scrub the staging dir.
            await rm(staging, { recursive: true }).catch((scrubErr) => {
              if (errnoCode(scrubErr) !== 'ENOENT') {
                console.warn(
                  `[scaffold] ${domain.name}: failed to scrub staging ${staging}:`,
                  scrubErr,
                );
              }
            });
            throw err;
          }
        } else {
          await copyTree(bundleSrc, bundleDst, /* allowSubdirs */ true);
        }
      }
    } else {
      // 'tree' — workflows + branding. Per-file overwrite, no rm. User-only
      // subdirs / files survive intact (e.g. an org's custom workflow folder,
      // an uploaded branding/images/logo.png).
      await copyTree(sourceDir, targetDir, /* allowSubdirs */ true);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[scaffold] ${domain.name}: copy failed for org "${orgSlug}":`,
      message,
    );
    return { domain: domain.name, ok: false, error: message };
  }

  return { domain: domain.name, ok: true };
}

/**
 * Best-effort opportunistic sweep of orphan transient dirs older than
 * 24h that survived a prior failed `rm` or process crash:
 *
 *   - Root-level `<root>/.deleted-*` (left by the two-phase rename-then-
 *     delete in `cleanupOrgFilesystem`).
 *   - Nested `<root>/<org>/<domain>/<bundle>.staging-<8hex>` and
 *     `.replacing-<8hex>` (left by `seedSingleDomain`'s bundle mode here,
 *     and by `skills/file_actions.ts:706-707` uploadSkillBundle). Without
 *     this, an orphan staging dir would make `dirHasFiles` return true
 *     and the next `override:false` scaffold would skip the whole domain
 *     indefinitely.
 *
 * Errors are swallowed per-entry (the main op shouldn't fail because of a
 * leftover dir we couldn't clean). Called from both `cleanupOrgFilesystem`
 * and `scaffoldNewOrganization` so reseed paths sweep too.
 */
const CONDEMNED_TTL_MS = 24 * 60 * 60 * 1000;
async function sweepStaleCondemnedDirs(root: string): Promise<void> {
  let rootEntries: string[];
  try {
    rootEntries = await readdir(root);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    throw err;
  }

  const now = Date.now();

  const tryRm = async (p: string): Promise<void> => {
    await rm(p, { recursive: true }).catch((err) => {
      console.warn(
        `[scaffold.janitor] rm ${p} failed:`,
        err instanceof Error ? err.message : err,
      );
    });
  };

  for (const orgEntry of rootEntries) {
    const orgPath = path.join(root, orgEntry);

    // Root-level `.deleted-*` orphan from cleanupOrgFilesystem.
    if (orgEntry.startsWith('.deleted-')) {
      const info = await lstat(orgPath).catch(() => null);
      if (!info || info.isSymbolicLink()) continue;
      if (now - info.mtimeMs < CONDEMNED_TTL_MS) continue;
      await tryRm(orgPath);
      continue;
    }

    // Skip non-org dotdirs at root and ignore non-directories. Org slugs
    // must validate against the same regex used to scaffold them, so we
    // don't accidentally recurse into a stray bind-mount.
    if (orgEntry.startsWith('.')) continue;
    if (!validateOrgSlug(orgEntry)) continue;
    const orgInfo = await lstat(orgPath).catch(() => null);
    if (!orgInfo || !orgInfo.isDirectory() || orgInfo.isSymbolicLink()) {
      continue;
    }

    let domainEntries: string[];
    try {
      domainEntries = await readdir(orgPath);
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(
          '[scaffold.janitor] readdir org dir failed:',
          orgPath,
          err,
        );
      }
      continue;
    }

    for (const domainName of domainEntries) {
      const domainPath = path.join(orgPath, domainName);
      const domainInfo = await lstat(domainPath).catch(() => null);
      if (
        !domainInfo ||
        !domainInfo.isDirectory() ||
        domainInfo.isSymbolicLink()
      ) {
        continue;
      }

      let leaves: string[];
      try {
        leaves = await readdir(domainPath);
      } catch (err) {
        if (errnoCode(err) !== 'ENOENT') {
          console.warn(
            '[scaffold.janitor] readdir domain dir failed:',
            domainPath,
            err,
          );
        }
        continue;
      }

      for (const leaf of leaves) {
        if (!STAGING_SUFFIX_RE.test(leaf)) continue;
        const leafPath = path.join(domainPath, leaf);
        const leafInfo = await lstat(leafPath).catch(() => null);
        if (!leafInfo || leafInfo.isSymbolicLink()) continue;
        if (now - leafInfo.mtimeMs < CONDEMNED_TTL_MS) continue;
        await tryRm(leafPath);
      }
    }
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

    // Opportunistic janitor: sweep stale `.deleted-*` siblings older than
    // 24h that survived a prior failed rm. Best-effort; failures only log.
    await sweepStaleCondemnedDirs(root).catch((err) => {
      console.warn('[cleanupOrgFilesystem] janitor sweep failed:', err);
    });

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
    // ENOENT instead of racing the recursive delete. UUID suffix avoids
    // collisions if two cleanups land in the same millisecond.
    const condemned = path.join(
      root,
      `.deleted-${args.orgSlug}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
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
    /**
     * When true, throw an aggregated error if any domain or retention
     * copy failed. Used by `reseedAllOrgsFromBuiltin` so partial failures
     * surface as non-zero CLI exit.
     *
     * When false (default), continue past per-domain failures and return
     * the per-domain result map. Used by `auth.afterCreateOrganization`
     * where partial-scaffold-on-org-create is preferable to blocking the
     * UX.
     */
    strict: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    skipped: v.boolean(),
    results: v.array(
      v.object({
        domain: v.string(),
        ok: v.boolean(),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (_ctx, args) => {
    if (!validateOrgSlug(args.orgSlug)) {
      console.warn(
        `[scaffoldNewOrganization] refusing invalid slug "${args.orgSlug}"`,
      );
      return { ok: false, skipped: true, results: [] };
    }

    // Symmetric guard to cleanupOrgFilesystem: refuse to operate on a
    // non-absolute or unset config root rather than writing relative
    // paths into the action's CWD.
    const configRoot = process.env.TALE_CONFIG_DIR;
    if (!configRoot || !path.isAbsolute(configRoot)) {
      const msg =
        '[scaffoldNewOrganization] TALE_CONFIG_DIR is unset or not absolute; refusing to proceed';
      console.error(msg);
      if (args.strict) {
        throw new Error(msg);
      }
      return { ok: false, skipped: true, results: [] };
    }

    // Opportunistic janitor: sweep root-level `.deleted-*` AND nested
    // `<org>/<domain>/<bundle>.staging-*` orphans older than 24h before
    // any per-domain work. Without this, a bundle staging dir orphaned
    // by a prior crash would make `dirHasFiles` return true and the
    // domain's non-override seed would skip indefinitely (round-2 P1-14).
    // Best-effort: errors only log.
    await sweepStaleCondemnedDirs(configRoot).catch((err) => {
      console.warn('[scaffoldNewOrganization] janitor sweep failed:', err);
    });

    const catalogRoot = process.env[BUILTIN_ENV];
    const override = args.override ?? false;

    const results: DomainResult[] = [];
    for (const domain of CONFIG_DOMAINS) {
      results.push(
        await seedDomain(domain, catalogRoot, args.orgSlug, override),
      );
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0 && args.strict) {
      const detail = failed
        .map((r) => `${r.domain}: ${r.error ?? 'unknown error'}`)
        .join('; ');
      throw new Error(
        `scaffold "${args.orgSlug}": ${failed.length}/${results.length} domains failed — ${detail}`,
      );
    }

    return {
      ok: failed.length === 0,
      skipped: false,
      results,
    };
  },
});
