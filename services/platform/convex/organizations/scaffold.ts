'use node';

/**
 * Scaffold + cleanup per-org filesystem config under the uniform org-first
 * layout (`$TALE_CONFIG_DIR/<orgSlug>/<domain>/...` for every org incl.
 * `default`). Source of seed data is the GENERIC builtin catalog baked into
 * the convex image at `$TALE_CONFIG_BUILTIN_DIR/<domain>/` — its children ARE
 * the domains, with no org level and no `default` join (set in
 * services/platform/Dockerfile, propagated via the entrypoint's
 * `convex env set` loop). There is NO fallback: scaffold refuses to proceed
 * when `$TALE_CONFIG_BUILTIN_DIR` is unset (dev-engine/prod/E2E all set it).
 *
 * `scaffoldNewOrganization`:
 *   - org-create path (`cleanFirst:true`, scheduled from
 *     `auth.afterCreateOrganization`): purge any leftover `<orgSlug>/` subtree
 *     first — the slug is provably new at that hook, so anything there is an
 *     orphan from a deleted org or a dev wipe — then seed every domain into the
 *     now-empty dir. The result is a faithful, complete copy of the catalog
 *     with no stale/renamed orphans and no cross-tenant secret inheritance.
 *   - bare org-create / retry (`override:false`, default, no `cleanFirst`):
 *     idempotent per-domain skip if the target dir already has files.
 *   - reseed path (`override:true`, called by `reseedAllOrgsFromBuiltin`):
 *     overwrites builtin-named files in place while always preserving
 *     `*.secrets.json` and `.history/` trails. Per-domain semantics —
 *     flat: per-file atomicWrite (providers/prompts/governance —
 *     governance also carries the `retention.json` bounds catalog as a
 *     flat file); dir-bundle (skills/integrations/automations): a staged
 *     copy atomic-renamed over `<per-bundle>` (`replaceBundleDir`); tree
 *     (agents/branding): per-file overwrite recursing into subdirs
 *     (agent folders, user-only folders / images preserved).
 *
 * `cleanupOrgFilesystem` removes the entire `<orgSlug>/` subtree (org is
 * one tree under org-first), guarded by validateOrgSlug + verifyPathWithinBase
 * + an lstat symlink defense (an attacker-placed symlink at the org dir
 * would otherwise be followed by `rm -rf` to arbitrary filesystem
 * locations). Uses a two-phase rename-then-delete so concurrent writers
 * fail with ENOENT rather than racing the recursive delete.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
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

import { domainCatalogFileSchema } from '../../lib/shared/config/catalog_validator';
import {
  CONFIG_DOMAINS,
  type ConfigDomain,
} from '../../lib/shared/config/registry';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
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
// `'use node'` Layer-B resolver map (`lib/config_store/resolvers.ts`). The
// generic catalog tree at `$TALE_CONFIG_BUILTIN_DIR/<domain>/` (no org level)
// is the source for every org including `default`. Copy semantics per
// `domain.scaffoldKind`:
//   - 'flat'   = one file per item, no subdirs (providers/prompts/
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
 * Source-side companion to {@link dirHasFiles}: does this CATALOG dir contain
 * anything the scaffold copy would actually seed? Mirrors {@link copyTree}'s
 * name-level source filters exactly — dotfiles (`.gitkeep`, `.history/`, tmp
 * orphans), `SKIP_DIR_NAMES`, and `*.secrets.json` are never copied, so they
 * must not count as seedable either. Without this, a catalog domain holding
 * only a `.gitkeep` (the e2e/manual fixture catalog ships three) is reported
 * missing forever: the probe sees "content", the copy seeds nothing, and the
 * provisioning banner + retry loop can never converge (#2676).
 *
 * Deliberately NOT used for target-side checks: a target holding only
 * `.history/` is *occupied* (see {@link seedDomain}'s override:false skip),
 * and the probe's target side must agree with that skip. Deeper type-level
 * mismatches (symlink-only or subdir-only sources a specific scaffoldKind
 * would skip) stay out of scope here — `retryProvisioning`'s post-repair
 * re-probe reports those honestly instead.
 */
async function dirHasSeedableEntries(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some(
      (n) => !n.startsWith('.') && !SKIP_DIR_NAMES.has(n) && !shouldSkipFile(n),
    );
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') {
      console.warn(
        '[scaffold.dirHasSeedableEntries] readdir failed:',
        dir,
        err,
      );
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
export async function pathsOverlap(a: string, b: string): Promise<boolean> {
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

/**
 * A single `.json` catalog file that fails its domain schema is SKIPPED
 * (warn + return false) rather than copied — corrupt bytes must never reach
 * a new org's disk. `jsonSchemaDomain` is optional so callers with no domain
 * context (or domains `domainCatalogFileSchema` doesn't cover) keep copying
 * unchecked, matching this guard's narrower "catch the common case" scope
 * (the CI gate, `configs:validate`, is the exhaustive one).
 */
function catalogJsonFileIsValid(
  domain: string,
  fileName: string,
  text: string,
): boolean {
  const schema = domainCatalogFileSchema(domain, fileName);
  if (!schema) return true; // no reusable schema for this domain/filename — unchecked.

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error(
      `[scaffold] skipping corrupt ${domain}/${fileName}: not valid JSON — ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return false;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[scaffold] ${zodErrorMessage(`skipping corrupt ${domain}/${fileName}`, result.error)}`,
    );
    return false;
  }
  return true;
}

export async function writeFileFromCatalog(
  src: string,
  dst: string,
  jsonSchemaDomain?: string,
): Promise<void> {
  const buf = await readFile(src);
  const name = path.basename(src);
  if (name.endsWith('.json')) {
    const text = buf.toString('utf-8');
    if (
      jsonSchemaDomain &&
      !catalogJsonFileIsValid(jsonSchemaDomain, name, text)
    ) {
      return;
    }
    await atomicWrite(dst, text);
  } else if (
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
 *
 * `jsonSchemaDomain` (the domain name, e.g. `'providers'`) is threaded down
 * to `writeFileFromCatalog` so each `.json` file is schema-checked before
 * being written — omit it (as the admin resync path in
 * `organizations/builtin_sync.ts` still does) to copy unchecked.
 */
export async function copyTree(
  sourceDir: string,
  targetDir: string,
  allowSubdirs = true,
  jsonSchemaDomain?: string,
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
      await copyTree(src, dst, allowSubdirs, jsonSchemaDomain);
      continue;
    }

    if (!info.isFile()) continue;
    await writeFileFromCatalog(src, dst, jsonSchemaDomain);
  }
}

/**
 * Copy `sourceDir` into `targetDir` verbatim — unlike {@link copyTree}, this
 * keeps `*.secrets.json` and any `.history/` trail (dotfiles included): its
 * job is to preserve everything a destructive bundle replace would otherwise
 * destroy. Skips symlinks (never dereference). Used by the per-domain admin
 * sync's bundle backup (`organizations/builtin_sync.ts`, org bundle → its
 * `.history/` backup).
 */
export async function copyTreeVerbatim(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyTreeVerbatim(src, dst);
      continue;
    }
    if (!entry.isFile()) continue;
    await atomicWriteBuffer(dst, await readFile(src));
  }
}

/**
 * Every BUNDLE under a bundle-domain's catalog dir, as paths relative to it
 * (`my-skill`, or `gmail/reply-emails` for a nesting domain).
 *
 * A domain that declares `nestedBundles` (automations) is walked to its bundle
 * ROOTS — a dir carrying one of the domain's manifest markers IS a bundle and
 * the walk stops there; a dir carrying none is a GROUP dir and is descended
 * into, up to the declared depth. Every other bundle domain (skills,
 * integrations) is read one dir level deep, exactly as before. Symlinks,
 * dotfiles and `.history` are skipped at every level.
 */
async function listCatalogBundlePaths(
  sourceDir: string,
  domain: ConfigDomain,
): Promise<string[]> {
  const nesting = domain.nestedBundles;
  const bundles: string[] = [];

  const walk = async (dir: string, prefix: string): Promise<void> => {
    // ENOENT at the ROOT is the caller's "no catalog dir" signal, so only the
    // top-level readdir is allowed to throw.
    const entries = await readdir(dir);
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      if (SKIP_DIR_NAMES.has(name)) continue;
      const abs = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(abs).catch((err) => {
        if (errnoCode(err) !== 'ENOENT') {
          console.warn(`[scaffold] ${domain.name}: lstat ${abs} failed:`, err);
        }
        return null;
      });
      if (!info || info.isSymbolicLink() || !info.isDirectory()) continue;
      if (!nesting) {
        bundles.push(rel);
        continue;
      }
      const isBundle = nesting.markers.some((marker) =>
        existsSync(path.join(abs, marker)),
      );
      if (isBundle) {
        bundles.push(rel);
      } else if (rel.split('/').length < nesting.maxDepth) {
        await walk(abs, rel).catch((err) => {
          console.warn(
            `[scaffold] ${domain.name}: readdir ${abs} failed:`,
            err,
          );
        });
      }
    }
  };

  await walk(sourceDir, '');
  return bundles;
}

/**
 * Replace one bundle dir with a copy of `bundleSrc`, via a sibling staging dir
 * + atomic rename. Eliminates the "rm before copy" window where an interrupt
 * would leave an empty bundle on disk. `force` dropped so EACCES / EBUSY
 * surface as real errors. Shared by the bundle-domain override seed below and
 * the per-domain admin sync (`organizations/builtin_sync.ts`).
 */
export async function replaceBundleDir(
  bundleSrc: string,
  bundleDst: string,
  jsonSchemaDomain?: string,
): Promise<void> {
  const staging = `${bundleDst}.staging-${randomUUID().slice(0, 8)}`;
  try {
    await copyTree(
      bundleSrc,
      staging,
      /* allowSubdirs */ true,
      jsonSchemaDomain,
    );
    // Best-effort old-dir removal before rename. If the old dir exists and is
    // non-empty, `rename` will fail on most platforms — surface that.
    await rm(bundleDst, { recursive: true }).catch((err) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    });
    await rename(staging, bundleDst);
  } catch (err) {
    // If anything went wrong, scrub the staging dir.
    await rm(staging, { recursive: true }).catch((scrubErr) => {
      if (errnoCode(scrubErr) !== 'ENOENT') {
        console.warn(
          `[scaffold] failed to scrub staging ${staging}:`,
          scrubErr,
        );
      }
    });
    throw err;
  }
}

/**
 * Seed a single domain for an org. Source is `<catalogRoot>/<domain>` — the
 * generic built-in catalog (`TALE_CONFIG_BUILTIN_DIR`), whose children ARE the
 * domains. There is deliberately no `default`/org level and no fallback to any
 * org's live dir: every org is seeded only from the built-in catalog.
 *
 * Returns `{ok:true}` on success (including the legitimate
 * "already scaffolded, skipped" case) and `{ok:false, error}` on
 * real failure so the handler can surface or aggregate. Per-domain
 * errors are also logged here for operator visibility.
 *
 * Exported for the per-domain admin sync (`organizations/builtin_sync.ts`),
 * which reuses the exact reseed copy semantics for one domain of one org.
 */
export async function seedDomain(
  domain: ConfigDomain,
  catalogRoot: string,
  orgSlug: string,
  override: boolean,
): Promise<DomainResult> {
  // Domains without a `scaffoldKind` are not catalog-scaffolded (e.g. `sso`,
  // whose single connection.json is created on demand by the admin form). They
  // ship no builtin catalog dir, so skip them here — otherwise the missing
  // `<catalogRoot>/<domain>` would be reported as a deploy misconfig below.
  if (!domain.scaffoldKind) {
    return { domain: domain.name, ok: true };
  }
  const sourceDir = path.join(catalogRoot, domain.name);
  const targetDir = resolveDomainDir(domain.name, orgSlug);

  // The built-in catalog's domain dir must exist; missing = deploy misconfig
  // (platform/convex image version skew). Surface in logs AND return an error
  // so reseed-all-orgs can fail loudly.
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

  // copy-onto-self guard: realpath-aware. The catalog and the org data tree
  // are normally distinct dirs, so this only fires on a symlinked/bind-mount
  // overlap between the catalog and data trees (defense against wiping live
  // data via `rm -rf <bundle>` then copy-from-self).
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
      await copyTree(
        sourceDir,
        targetDir,
        /* allowSubdirs */ false,
        domain.name,
      );
    } else if (domain.scaffoldKind === 'bundle') {
      // For each catalog BUNDLE (a leaf dir carrying the domain's manifest when
      // the domain nests — never a group dir like `automations/gmail/`), rm -rf
      // the corresponding target bundle (if override) then copy. Replacing at
      // the GROUP level would delete an org-authored bundle that merely shares a
      // group dir with a builtin, so the walk descends to the real bundle roots.
      // Domain-root siblings (.history/, *.secrets.json at the domain dir level)
      // survive — we only touch bundles that exist in the catalog.
      let bundles: string[];
      try {
        bundles = await listCatalogBundlePaths(sourceDir, domain);
      } catch (err) {
        if (errnoCode(err) === 'ENOENT')
          return { domain: domain.name, ok: true };
        throw err;
      }
      for (const bundleName of bundles) {
        const bundleSrc = path.join(sourceDir, bundleName);
        const bundleDst = path.join(targetDir, bundleName);
        if (override) {
          await replaceBundleDir(bundleSrc, bundleDst, domain.name);
        } else {
          await copyTree(
            bundleSrc,
            bundleDst,
            /* allowSubdirs */ true,
            domain.name,
          );
        }
      }
    } else {
      // 'tree' — workflows + branding. Per-file overwrite, no rm. User-only
      // subdirs / files survive intact (e.g. an org's custom workflow folder,
      // an uploaded branding/images/logo.png).
      await copyTree(
        sourceDir,
        targetDir,
        /* allowSubdirs */ true,
        domain.name,
      );
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
 * Guarded removal of one org's entire `<orgSlug>/` subtree under `root`.
 * Extracted so both org-delete (`cleanupOrgFilesystem`) and the exact-mirror
 * org-create path (`scaffoldNewOrganization({cleanFirst:true})`) share a single
 * audited deletion. Safety — all preserved from the former inline cleanup body:
 * - refuses the literal `default` slug (the historical shared template name).
 * - validates slug shape via `validateOrgSlug` (a NULL / `..` / cased slug from
 *   a misbehaving caller can't slip through).
 * - refuses `orgDir === root`.
 * - `verifyPathWithinBase` enforces strict descendant-of-root containment.
 * - `lstat`-refuses a symlink at the org dir itself: `verifyPathWithinBase`
 *   only realpath's the dirname, so a pre-placed symlink at `<root>/<orgSlug>`
 *   would otherwise be followed by `rm -rf` to arbitrary locations.
 * - two-phase rename-then-delete: rename to a `.deleted-<slug>-<ts>` sibling
 *   (atomic) then `rm -rf`, so concurrent writers fail ENOENT instead of racing.
 * - drops `{ force: true }` so EACCES/EBUSY surface instead of being masked.
 *
 * ENOENT at the org dir is an idempotent no-op (nothing to remove). All
 * failures log and are non-fatal: the caller decides what happens next
 * (cleanup returns regardless; cleanFirst proceeds to seed, where the
 * `override:false` per-domain skip is the safe fallback if removal was refused).
 */
async function removeOrgSubtree(root: string, orgSlug: string): Promise<void> {
  if (orgSlug === 'default') {
    console.warn(
      '[removeOrgSubtree] refusing to delete the default org filesystem',
    );
    return;
  }

  if (!validateOrgSlug(orgSlug)) {
    console.warn(`[removeOrgSubtree] refusing invalid slug "${orgSlug}"`);
    return;
  }

  const orgDir = path.join(root, orgSlug);
  if (path.resolve(orgDir) === path.resolve(root)) {
    console.warn('[removeOrgSubtree] computed orgDir equals root, refusing');
    return;
  }

  try {
    await verifyPathWithinBase(orgDir, root);
  } catch (err) {
    console.warn(
      `[removeOrgSubtree] path traversal guard tripped for "${orgSlug}":`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  // Symlink hijack defense: verifyPathWithinBase leaves the basename
  // unresolved. If <root>/<orgSlug> is itself a symlink, rm -rf would follow
  // it and delete arbitrary filesystem locations. Refuse explicitly here.
  const info = await lstat(orgDir).catch((err) => {
    if (errnoCode(err) === 'ENOENT') return null;
    console.warn(
      `[removeOrgSubtree] lstat failed for "${orgDir}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  if (!info) return;
  if (info.isSymbolicLink()) {
    console.error(
      `[removeOrgSubtree] refusing to delete symlinked org dir at "${orgDir}"`,
    );
    return;
  }

  // Two-phase rename-then-delete. The rename is atomic within a filesystem;
  // any concurrent writer of the original path fails with ENOENT instead of
  // racing the recursive delete. UUID suffix avoids collisions.
  const condemned = path.join(
    root,
    `.deleted-${orgSlug}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  try {
    await rename(orgDir, condemned);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    console.error(
      `[removeOrgSubtree] rename failed for "${orgDir}" → "${condemned}":`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  try {
    await rm(condemned, { recursive: true });
  } catch (err) {
    console.error(
      `[removeOrgSubtree] rm failed for "${condemned}" (org dir was renamed but not fully removed; manual cleanup required):`,
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

    // Opportunistic janitor: sweep stale `.deleted-*` siblings older than
    // 24h that survived a prior failed rm. Best-effort; failures only log.
    await sweepStaleCondemnedDirs(root).catch((err) => {
      console.warn('[cleanupOrgFilesystem] janitor sweep failed:', err);
    });

    // Guarded two-phase removal. The slug / path-containment / symlink
    // defenses live in the shared helper that org-create's cleanFirst path
    // also uses, so both deletion entry points stay in lockstep.
    await removeOrgSubtree(root, args.orgSlug);

    return null;
  },
});

export interface ScaffoldRunResult {
  ok: boolean;
  skipped: boolean;
  results: DomainResult[];
}

/**
 * The scaffold core, callable as a plain function so the provisioning-repair
 * action (`organizations/actions.ts:retryProvisioning`) can re-run the exact
 * org-create seeding in-process instead of paying an action→action hop.
 * Semantics are documented on {@link scaffoldNewOrganization}, whose handler
 * delegates here.
 */
export async function scaffoldOrgFromCatalog(args: {
  orgSlug: string;
  override?: boolean;
  strict?: boolean;
  cleanFirst?: boolean;
}): Promise<ScaffoldRunResult> {
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

  // The built-in catalog is required — there is no fallback to any org's live
  // dir. Dev (dev-engine), prod (Dockerfile), and E2E (playwright) all set it.
  const catalogRoot = process.env[BUILTIN_ENV];
  if (!catalogRoot || !path.isAbsolute(catalogRoot)) {
    const msg = `[scaffoldNewOrganization] ${BUILTIN_ENV} is unset or not absolute; refusing to proceed`;
    console.error(msg);
    if (args.strict) {
      throw new Error(msg);
    }
    return { ok: false, skipped: true, results: [] };
  }
  const override = args.override ?? false;

  // Exact-mirror org-create: purge any leftover subtree for this (new) slug
  // before seeding, so renamed/removed catalog files don't survive as
  // orphans and the per-domain `override:false` skip can't strand a domain a
  // prior org left files in. Guarded + idempotent (a no-op when absent).
  if (args.cleanFirst) {
    await removeOrgSubtree(configRoot, args.orgSlug);
  }

  const results: DomainResult[] = [];
  for (const domain of CONFIG_DOMAINS) {
    results.push(await seedDomain(domain, catalogRoot, args.orgSlug, override));
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
}

/**
 * Derived provisioning status for one org: the scaffold-covered domains whose
 * builtin catalog dir HAS seedable files while the org's dir has none — i.e.
 * the org-create seed would have copied something but demonstrably didn't (the
 * failure mode a crashed/skipped `scaffoldNewOrganization` leaves behind).
 * "Seedable" mirrors what the copy actually copies (`dirHasSeedableEntries`):
 * a catalog dir holding only dotfiles/secrets seeds nothing, so it is never
 * reported missing (#2676). Deliberately file-derived rather than persisted:
 * no schema change, and the signal self-heals the moment a retry (or any
 * reseed) lands the files.
 *
 * Returns `null` when the probe cannot run (config root or builtin catalog
 * env unset) — callers must treat that as "unknown", not "unprovisioned",
 * so a misconfigured deploy doesn't nag every org with an unrepairable
 * banner. A partially-copied single domain (dir exists but incomplete) is
 * out of scope: the per-domain catalog sync covers that repair.
 */
export async function listMissingScaffoldDomains(
  orgSlug: string,
): Promise<string[] | null> {
  if (!validateOrgSlug(orgSlug)) return null;
  const configRoot = process.env.TALE_CONFIG_DIR;
  const catalogRoot = process.env[BUILTIN_ENV];
  if (!configRoot || !path.isAbsolute(configRoot)) return null;
  if (!catalogRoot || !path.isAbsolute(catalogRoot)) return null;

  const missing: string[] = [];
  for (const domain of CONFIG_DOMAINS) {
    if (!domain.scaffoldKind) continue; // not catalog-scaffolded (e.g. sso)
    const sourceDir = path.join(catalogRoot, domain.name);
    // Source side: only entries the copy would seed count (#2676).
    if (!(await dirHasSeedableEntries(sourceDir))) continue; // nothing to seed from
    const targetDir = resolveDomainDir(domain.name, orgSlug);
    // Target side: `dirHasFiles` on purpose — it must agree with
    // `seedDomain`'s override:false occupied-skip (a `.history/`-only target
    // is occupied, not missing, or retry could never clear it).
    if (!(await dirHasFiles(targetDir))) missing.push(domain.name);
  }
  return missing;
}

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
    /**
     * When true (the org-create path), remove any leftover `<orgSlug>/`
     * subtree before seeding so the result is a faithful copy of the catalog
     * with no stale/renamed orphans. Safe because Better Auth's
     * `afterCreateOrganization` fires only for a genuinely new slug — anything
     * already on disk is an orphan from a deleted org or a dev wipe, and would
     * otherwise trip the per-domain `override:false` skip (stranding e.g. a
     * renamed agent permanently missing). It also prevents a new org from
     * inheriting a prior tenant's `*.secrets.json` if delete-time cleanup never
     * ran. NOT set by `reseedAllOrgsFromBuiltin`, which reseeds LIVE orgs and
     * must preserve their secrets/customizations (that path uses `override`).
     */
    cleanFirst: v.optional(v.boolean()),
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
    return await scaffoldOrgFromCatalog(args);
  },
});
