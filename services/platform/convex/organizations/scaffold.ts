'use node';

/**
 * Scaffold per-org filesystem config on organization creation.
 *
 * Seeds new orgs from the immutable builtin catalog baked into the convex
 * image at `$TALE_CONFIG_BUILTIN_DIR/<domain>/` (mirrors the writable
 * `$TALE_CONFIG_DIR/<domain>/` pattern). The env is pushed by the platform
 * Dockerfile via the entrypoint's `convex env set` loop. Falls back to the
 * default org's writable dir when the env is unset, so local `bun dev`
 * (where no catalog is built) still works. The rationale for sourcing from
 * the read-only catalog instead of the default workspace lives at the
 * `@`-prefix-skip comment in copyTree below — that's the load-bearing site.
 *
 * Skips per-org secrets (`*.secrets.json`) and local edit-history dirs
 * (`.history/`). Skips branding entirely — read-side hardcodes 'default'.
 *
 * Idempotent: if the target dir already contains user-visible files, skip
 * that domain with a warning rather than overwriting.
 */

import { lstat, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { resolveAgentsDir } from '../agents/file_utils';
import { resolveIntegrationsDir } from '../integrations/file_utils';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  verifyPathWithinBase,
} from '../lib/file_io';
import { resolveProvidersDir } from '../providers/file_utils';
import { resolveSkillsDir } from '../skills/file_utils';
import { resolveWorkflowsDir } from '../workflows/file_utils';

type DirResolver = (orgSlug: string) => string;

type Domain = {
  name: string;
  resolve: DirResolver;
  // Flat domains store one file per item with no subdirectories in the
  // catalog (agents/providers: `<slug>.json`). copyTree must not recurse into
  // subdirs for these — see the `allowSubdirs` guard in copyTree.
  flat?: boolean;
};

// Each domain's per-org dir convention differs — use the domain's own resolver.
// The catalog subdir name matches `name` (e.g., `$TALE_CONFIG_BUILTIN_DIR/agents/`).
const DOMAINS: Domain[] = [
  { name: 'agents', resolve: resolveAgentsDir, flat: true },
  { name: 'providers', resolve: resolveProvidersDir, flat: true },
  { name: 'integrations', resolve: resolveIntegrationsDir },
  { name: 'workflows', resolve: resolveWorkflowsDir },
  { name: 'skills', resolve: resolveSkillsDir },
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
// has been here and we must not overwrite.
function isAtomicWriteTmp(name: string): boolean {
  return name.startsWith('.') && name.endsWith('.tmp');
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some((n) => !isAtomicWriteTmp(n));
  } catch (err) {
    // ENOENT (dir doesn't exist yet) is the expected case — domain scaffold
    // simply hasn't run. Anything else (EACCES, EIO) means we can't read
    // it; treat as "empty" so scaffolding proceeds, but log so a
    // permissions glitch isn't silently masked.
    if (errnoCode(err) !== 'ENOENT') {
      console.warn('[scaffold.dirHasFiles] readdir failed:', dir, err);
    }
    return false;
  }
}

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
    // Per-org marker prefix used by skills / integrations / workflows for
    // tenant subdirs (`@<orgSlug>/...`). Defence-in-depth: the builtin
    // catalog has no `@` subdirs, but if the source ever falls back to a
    // mutable workspace this guard prevents recursing into other orgs'
    // trees. Agents / providers use raw `<slug>` subdirs (no `@` marker) and
    // are flat-copied (`allowSubdirs=false` below), so a stray raw-slug subdir
    // in a fallback workspace is never recursed into either — the cross-tenant
    // leak is structurally impossible on any source path.
    if (name.startsWith('@')) continue;
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (shouldSkipFile(name)) continue;

    const src = path.join(sourceDir, name);
    const dst = path.join(targetDir, name);

    // lstat (not stat) so a symlink in the source is detected and skipped
    // rather than followed. The catalog is built from `examples/` which
    // tracks no symlinks today, but this keeps the scaffold from
    // dereferencing through to arbitrary paths if one is ever introduced.
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
        // Flat domain (agents / providers): the catalog has no subdirs here,
        // so any subdir is unexpected (e.g. a raw-slug org dir leaked into a
        // mutable fallback workspace). Skip rather than recurse.
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

    const buf = await readFile(src);
    if (
      name.endsWith('.json') ||
      name.endsWith('.ts') ||
      name.endsWith('.svg')
    ) {
      await atomicWrite(dst, buf.toString('utf-8'));
    } else {
      await atomicWriteBuffer(dst, buf);
    }
  }
}

/**
 * Remove a deleted org's per-domain filesystem dirs. Safety:
 * - Refuses the `default` slug (the global/system org's baseline).
 * - Uses each domain's own resolver so we only touch paths that follow
 *   the established convention (no manual string-building).
 * - Verifies the resolved per-org dir is strictly inside the domain's
 *   base dir via `verifyPathWithinBase` — blocks slug traversal like
 *   `../foo` even though `validateOrgSlug` should have already caught it.
 * - ENOENT on the per-org dir is silently ignored (idempotent; nothing
 *   to clean up).
 */
export const cleanupOrgFilesystem = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    if (args.orgSlug === 'default') {
      console.warn(
        '[cleanupOrgFilesystem] refusing to delete the default org filesystem',
      );
      return null;
    }

    for (const domain of DOMAINS) {
      const baseDir = domain.resolve('default');
      let targetDir: string;
      try {
        targetDir = domain.resolve(args.orgSlug);
      } catch (err) {
        console.warn(
          `[cleanupOrgFilesystem] ${domain.name}: skipping invalid slug "${args.orgSlug}":`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      // The default-org's base dir is the per-domain baseDir itself; a
      // per-org dir must be a strict descendant, never equal.
      if (targetDir === baseDir) {
        console.warn(
          `[cleanupOrgFilesystem] ${domain.name}: target equals base dir, skipping`,
        );
        continue;
      }

      try {
        await verifyPathWithinBase(targetDir, baseDir);
      } catch (err) {
        console.warn(
          `[cleanupOrgFilesystem] ${domain.name}: path traversal guard tripped for "${args.orgSlug}":`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      try {
        await rm(targetDir, { recursive: true, force: true });
      } catch (err) {
        if (errnoCode(err) === 'ENOENT') continue;
        console.error(
          `[cleanupOrgFilesystem] ${domain.name}: failed to remove "${targetDir}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return null;
  },
});

export const scaffoldNewOrganization = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    if (args.orgSlug === 'default') {
      // The default org's files are seeded by the Docker entrypoint; nothing to do.
      return null;
    }

    const builtinRoot = process.env[BUILTIN_ENV];

    for (const domain of DOMAINS) {
      // Prefer `$TALE_CONFIG_BUILTIN_DIR/<domain>/` (set by platform
      // Dockerfile, pushed into Convex's deployment env). Falls back to
      // the default org's dir when the env is unset — covers local
      // `bun dev` (no catalog built) and a rollback to a platform image
      // that doesn't declare the env.
      const sourceDir = builtinRoot
        ? path.join(builtinRoot, domain.name)
        : domain.resolve('default');
      const targetDir = domain.resolve(args.orgSlug);

      // copyTree's ENOENT-silent contract is correct for the fallback case
      // (default-org dir may legitimately not be seeded yet). But when an
      // operator-configured catalog path doesn't exist, that's a deploy
      // misconfig (e.g., platform/convex image version skew) and the
      // resulting zero-seed should NOT look like a successful copy. Probe
      // explicitly so the failure surfaces in logs.
      if (builtinRoot) {
        const sourceExists = await stat(sourceDir)
          .then(() => true)
          .catch((err) => {
            // ENOENT: catalog domain dir missing — a deploy misconfig
            // (platform/convex image skew). Other errors (EACCES, EIO) are a
            // distinct failure; log each accurately rather than mislabelling
            // a permission error as "does not exist".
            if (errnoCode(err) === 'ENOENT') {
              console.error(
                `[scaffoldNewOrganization] ${domain.name}: ${BUILTIN_ENV}=${builtinRoot} is set but ${sourceDir} does not exist; new org "${args.orgSlug}" will receive zero seed data for this domain`,
              );
            } else {
              console.error(
                `[scaffoldNewOrganization] ${domain.name}: stat ${sourceDir} failed:`,
                err instanceof Error ? err.message : err,
              );
            }
            return false;
          });
        if (!sourceExists) continue;
      }

      const alreadyScaffolded = await dirHasFiles(targetDir);
      if (alreadyScaffolded) {
        console.warn(
          `[scaffoldNewOrganization] ${domain.name}: target ${targetDir} already has files, skipping`,
        );
        continue;
      }

      try {
        await copyTree(sourceDir, targetDir, !domain.flat);
      } catch (err) {
        console.error(
          `[scaffoldNewOrganization] ${domain.name}: copy failed for org "${args.orgSlug}":`,
          err instanceof Error ? err.message : err,
        );
        // Continue with other domains; partial scaffolding is better than none.
      }
    }

    return null;
  },
});
