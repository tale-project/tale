'use node';

/**
 * Scaffold + cleanup per-org filesystem config under the uniform org-first
 * layout (`$TALE_CONFIG_DIR/<orgSlug>/<domain>/...` for every org incl.
 * `default`). Source of seed data is the GENERIC builtin catalog — its
 * children ARE the domains, with no org level and no `default` join. The
 * root resolves via `lib/config_store/builtin_catalog.ts`:
 * `$TALE_CONFIG_BUILTIN_DIR` when set (Dockerfile in prod, dev-engine, E2E),
 * else the repo checkout's `configs/platform/custom/` when one is reachable
 * from the working directory. There is NO fallback to any org's live dir:
 * scaffold refuses to proceed when neither source resolves.
 *
 * MINIMAL interim version: the config-domain registry
 * (`lib/shared/config/registry.ts`) currently registers only `governance`
 * (`scaffoldKind: 'flat'`) and `sso` (not catalog-scaffolded — its
 * `connection.yml` is created on demand by the admin form). Only the `flat`
 * copy semantics are implemented below; `seedDomain` throws for `bundle`/
 * `tree` domains rather than silently mis-seeding them (see its doc comment).
 *
 * Re-expands this with the `configs/` YAML catalog and the
 * `bundle`/`tree` scaffoldKind branches (dir-bundle replace, recursive
 * per-file tree overwrite) as the ripped-out domains (agents/automations/
 * connectors/providers/skills/…) re-register in the Layer-A registry.
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
 *     `*.secrets.json` and `.history/` trails.
 *
 * A missing PER-DOMAIN catalog dir (e.g. `$TALE_CONFIG_BUILTIN_DIR/governance/`
 * doesn't exist) degrades gracefully to `{ok:true}` with nothing seeded — the
 * rebuilt catalog (the config-system rewrite) hasn't landed on every deployment yet, so
 * this must not read as a deploy misconfig the way a genuinely broken stat
 * (EACCES/EIO) still does. The top-level `TALE_CONFIG_BUILTIN_DIR` env guard
 * (unset / not absolute) is unchanged from before — that is a real
 * misconfiguration, not a "catalog not rebuilt yet" situation.
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

import type { z } from 'zod/v4';

import {
  CONFIG_DOMAINS,
  type ConfigDomain,
} from '../../../lib/shared/config/registry';
import { parseYaml } from '../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import { resolveBuiltinCatalogRoot } from '../lib/config_store/builtin_catalog';
import { resolveDomainDir } from '../lib/config_store/resolvers';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  validateOrgSlug,
  verifyPathWithinBase,
} from '../lib/file_io';

// Re-exported alongside the scaffold/cleanup primitives so a caller of this
// module doesn't need a second import from `lib/file_io` just for the slug
// shape check (same regex/behavior — this is a re-export, not a fork).
export { validateOrgSlug };

export type DomainResult = {
  domain: string;
  ok: boolean;
  error?: string;
};

// The set of domains to seed comes from the single config-domain registry
// (`lib/shared/config/registry.ts`); their on-disk dirs are resolved via the
// `'use node'` Layer-B resolver map (`lib/config_store/resolvers.ts`). The
// generic catalog tree at `<catalogRoot>/<domain>/` (no org level) is the
// source for every org including `default`. Copy semantics per
// `domain.scaffoldKind` — MINIMAL interim implements only:
//   - 'flat' = one file per item, no subdirs. Today that's just `governance`.
//     override:true overwrites per-file via atomicWrite; user-added files
//     survive, secrets sidecars + `.history/` at the dir level survive. A
//     catalog `.yml`/`.json` file that matches one of the domain's
//     `seedSchemas` keys is schema-validated before being written (corrupt files are
//     skipped, never copied); anything else (e.g. `retention.yml`) copies
//     unchecked.
// `bundle` (skills/connectors/automations pre-rewrite) and `tree`
// (agents/branding pre-rewrite) are NOT implemented — `seedDomain` throws for
// them; see its doc comment.

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

const SKIP_FILE_SUFFIXES = ['.secrets.json', '.secrets.yml'];
const SKIP_DIR_NAMES = new Set(['.history']);

function shouldSkipFile(name: string): boolean {
  return SKIP_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

// atomicWrite leaves `.<basename>.<ts>.<uuid>.tmp` orphans on crash. A future
// bundle-kind seed (the config-system rewrite) will stage into `<basename>.staging-
// <8hex>` / `<basename>.replacing-<8hex>` dirs, atomic-renamed onto the
// target — this helper already tolerates both patterns so neither locks out a
// retry by making `dirHasFiles` report "already scaffolded" indefinitely.
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
 * The schema for a single catalog config file (`.yml` or `.json`), keyed by
 * matching its basename (no extension) against the domain's `seedSchemas`
 * keys via `fileBaseFor`.
 * Returns `undefined` when the domain has no `seedSchemas` spec, or when no key
 * maps to this filename (e.g. governance's `retention.yml`, which is not a
 * policy) — the caller then copies the file unchecked, same as the old
 * per-domain `domainCatalogFileSchema` fallback.
 */
function schemaForCatalogFile(
  domain: ConfigDomain,
  fileName: string,
): z.ZodType | undefined {
  const seedSchemas = domain.seedSchemas;
  if (!seedSchemas) return undefined;
  const base = fileName.replace(/\.(yml|json)$/, '');
  for (const key of seedSchemas.keys) {
    if (seedSchemas.fileBaseFor(key) === base) {
      return seedSchemas.schemaFor(key);
    }
  }
  return undefined;
}

/**
 * A single catalog config file that fails its domain schema is SKIPPED
 * (warn + return false) rather than copied — corrupt bytes must never reach
 * a new org's disk. `.yml` parses through the shared safe loader, `.json`
 * through `JSON.parse`. Files with no matching `seedSchemas` key (or a domain
 * with no `seedSchemas` spec at all) keep copying unchecked (the CI
 * catalog-validation gate is the exhaustive check; this is only "catch the
 * common case").
 */
function catalogConfigFileIsValid(
  domain: ConfigDomain,
  fileName: string,
  text: string,
): boolean {
  const schema = schemaForCatalogFile(domain, fileName);
  if (!schema) return true;

  let parsed: unknown;
  if (fileName.endsWith('.yml')) {
    const outcome = parseYaml(text);
    if (!outcome.ok) {
      console.error(
        `[scaffold] skipping corrupt ${domain.name}/${fileName}: ${outcome.error}`,
      );
      return false;
    }
    parsed = outcome.data;
  } else {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error(
        `[scaffold] skipping corrupt ${domain.name}/${fileName}: not valid JSON — ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return false;
    }
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      `[scaffold] ${zodErrorMessage(`skipping corrupt ${domain.name}/${fileName}`, result.error)}`,
    );
    return false;
  }
  return true;
}

export async function writeFileFromCatalog(
  src: string,
  dst: string,
  domain?: ConfigDomain,
): Promise<void> {
  const buf = await readFile(src);
  const name = path.basename(src);
  if (name.endsWith('.yml') || name.endsWith('.json')) {
    const text = buf.toString('utf-8');
    if (domain && !catalogConfigFileIsValid(domain, name, text)) {
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
 * (`.<name>`), `*.secrets.json`, and symlinks at every level.
 *
 * `allowSubdirs=false` (used by flat domains) means: don't recurse into
 * any subdir found in the source. The catalog for flat domains has no
 * subdirs, so a subdir indicates a fallback workspace with leaked
 * cross-tenant content — skip with a warning rather than recurse.
 *
 * `domain` is threaded down to `writeFileFromCatalog` so each `.json` file
 * is schema-checked (via its `seedSchemas` mapping, when it has one) before being
 * written — omit it to copy unchecked.
 */
export async function copyTree(
  sourceDir: string,
  targetDir: string,
  allowSubdirs = true,
  domain?: ConfigDomain,
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
      await copyTree(src, dst, allowSubdirs, domain);
      continue;
    }

    if (!info.isFile()) continue;
    await writeFileFromCatalog(src, dst, domain);
  }
}

/**
 * Seed a single domain for an org. Source is `<catalogRoot>/<domain>` — the
 * generic built-in catalog (`TALE_CONFIG_BUILTIN_DIR`), whose children ARE the
 * domains. There is deliberately no `default`/org level and no fallback to any
 * org's live dir: every org is seeded only from the built-in catalog.
 *
 * `scaffoldKind: 'flat'` and `'bundle'` are implemented. A `tree` domain
 * throws rather than attempt copy semantics this module does not carry — a
 * silent no-op or a naive flat copy would either strand an operator expecting
 * a real seed or corrupt a nested tree layout. No registered domain is a
 * `tree` today, so the throw is a guard for a future registration, not a
 * reachable path.
 *
 * A missing `<catalogRoot>/<domain>` source dir degrades to `{ok:true}` with
 * nothing seeded (see the file header) rather than the deploy-misconfig
 * `{ok:false}` a genuine stat failure (EACCES/EIO) still returns.
 *
 * Returns `{ok:true}` on success (including the legitimate
 * "already scaffolded, skipped" case) and `{ok:false, error}` on
 * real failure so the handler can surface or aggregate. Per-domain
 * errors are also logged here for operator visibility.
 *
 * Exported for the pre-rewrite `v0_3_4/33` migration, which reuses this exact
 * seed primitive for one domain of one org.
 */
export async function seedDomain(
  domain: ConfigDomain,
  catalogRoot: string,
  orgSlug: string,
  override: boolean,
): Promise<DomainResult> {
  // Domains without a `scaffoldKind` are not catalog-scaffolded (e.g. `sso`,
  // whose single connection.yml is created on demand by the admin form).
  if (!domain.scaffoldKind) {
    return { domain: domain.name, ok: true };
  }

  // `flat` copies files only (governance, agents — one file per item); `bundle`
  // copies each item's whole `<slug>/` subtree (skills — a SKILL.md plus
  // assets). `tree` is not seedable yet.
  if (domain.scaffoldKind !== 'flat' && domain.scaffoldKind !== 'bundle') {
    throw new Error(
      `domain kind '${domain.scaffoldKind}' is not seedable until the ` +
        'config-system rewrite lands — upgrade through a pre-rewrite release first',
    );
  }

  const sourceDir = path.join(catalogRoot, domain.name);
  const targetDir = resolveDomainDir(domain.name, orgSlug);

  let statErr: unknown;
  const sourceExists = await stat(sourceDir)
    .then(() => true)
    .catch((err) => {
      statErr = err;
      return false;
    });
  if (!sourceExists) {
    if (errnoCode(statErr) === 'ENOENT') {
      // Interim degrade: the rebuilt YAML catalog (the config-system rewrite) hasn't
      // landed on every deployment yet, so a missing per-domain catalog dir
      // is expected rather than a deploy misconfig — warn and mark ok so
      // org create/reseed/retry-provisioning can prove out the lifecycle
      // ahead of the catalog.
      console.warn(
        `[scaffold] ${domain.name}: catalog root ${catalogRoot} resolves but ${sourceDir} does not exist yet (domain catalog not rebuilt) — nothing seeded`,
      );
      return { domain: domain.name, ok: true };
    }
    const msg = `stat ${sourceDir} failed: ${statErr instanceof Error ? statErr.message : String(statErr)}`;
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
    // Per-file atomicWrite. Overwrites only catalog-named files; user-added
    // files at the same dir survive (e.g., an org's custom governance
    // policy file we don't ship). Dir-level `.history`/secrets survive
    // (copyTree skips them at the source side, and per-file write doesn't
    // touch siblings).
    await copyTree(
      sourceDir,
      targetDir,
      /* allowSubdirs */ domain.scaffoldKind === 'bundle',
      domain,
    );
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
 *     `.replacing-<8hex>` (left by a bundle-kind seed once the config-system rewrite
 *     reintroduces one). Without this, an orphan staging dir would make
 *     `dirHasFiles` return true and the next `override:false` scaffold would
 *     skip the whole domain indefinitely.
 *
 * Errors are swallowed per-entry (the main op shouldn't fail because of a
 * leftover dir we couldn't clean). Called from both `cleanupOrgFilesystem`
 * and `scaffoldNewOrganization` so reseed paths sweep too.
 */
const CONDEMNED_TTL_MS = 24 * 60 * 60 * 1000;
export async function sweepStaleCondemnedDirs(root: string): Promise<void> {
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
 * audited deletion. Safety:
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
export async function removeOrgSubtree(
  root: string,
  orgSlug: string,
): Promise<void> {
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
  // any per-domain work. Best-effort: errors only log.
  await sweepStaleCondemnedDirs(configRoot).catch((err) => {
    console.warn('[scaffoldNewOrganization] janitor sweep failed:', err);
  });

  // The built-in catalog is required — there is no fallback to any org's live
  // dir. Resolution order (env override, then the repo checkout's
  // `configs/platform/custom/`) is documented in
  // `lib/config_store/builtin_catalog.ts`.
  const catalogRoot = resolveBuiltinCatalogRoot();
  if (!catalogRoot) {
    const msg = `[scaffoldNewOrganization] no builtin catalog: ${BUILTIN_ENV} is unset or not absolute and no repo configs/platform/custom is reachable; refusing to proceed`;
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
