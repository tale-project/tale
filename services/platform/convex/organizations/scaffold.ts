'use node';

/**
 * Scaffold per-org filesystem config on organization creation.
 *
 * Seeds new orgs from the immutable builtin catalog (`/app/{domain}-builtin/`
 * baked into the convex image), addressed per-domain via `*_BUILTIN_DIR` env
 * vars pushed from the platform Dockerfile. Falls back to the default org's
 * dir when the env is unset (dev / local convex), preserving the historical
 * behavior for that environment.
 *
 * Why the catalog and not `domain.resolve('default')`: the default org's dir
 * is a writable workspace, so anything created there (test workflows, scratch
 * agents) used to propagate into every newly-scaffolded org permanently.
 * Sourcing from the read-only catalog severs that channel. For agents and
 * providers — which use raw `<slug>/` per-org subdirs (no `@` marker) — this
 * also closes a genuine cross-tenant leak, since the old source could
 * recurse into other tenants' subdirs.
 *
 * Skips `*.secrets.json` (new org provides its own secrets) and `.history/`.
 * Skips branding (intentionally global; read-side hardcodes 'default').
 *
 * Idempotent: if the target dir already contains files, skip that domain
 * with a warning rather than overwriting.
 */

import { readdir, rm, lstat, readFile } from 'node:fs/promises';
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
  // Env var holding the absolute path to this domain's read-only catalog
  // (baked into the convex image as `/app/{name}-builtin/`). Set by the
  // platform Dockerfile so the entrypoint pushes it to Convex's deployment
  // env. Unset in local dev — see scaffoldNewOrganization for the fallback.
  builtinEnv: string;
};

// Each domain's per-org dir convention differs — use the domain's own resolver.
const DOMAINS: Domain[] = [
  {
    name: 'agents',
    resolve: resolveAgentsDir,
    builtinEnv: 'AGENTS_BUILTIN_DIR',
  },
  {
    name: 'providers',
    resolve: resolveProvidersDir,
    builtinEnv: 'PROVIDERS_BUILTIN_DIR',
  },
  {
    name: 'integrations',
    resolve: resolveIntegrationsDir,
    builtinEnv: 'INTEGRATIONS_BUILTIN_DIR',
  },
  {
    name: 'workflows',
    resolve: resolveWorkflowsDir,
    builtinEnv: 'WORKFLOWS_BUILTIN_DIR',
  },
  {
    name: 'skills',
    resolve: resolveSkillsDir,
    builtinEnv: 'SKILLS_BUILTIN_DIR',
  },
];

const SKIP_FILE_SUFFIXES = ['.secrets.json'];
const SKIP_DIR_NAMES = new Set(['.history']);

function shouldSkipFile(name: string): boolean {
  return SKIP_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.filter((n) => !n.startsWith('.')).length > 0;
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

async function copyTree(sourceDir: string, targetDir: string): Promise<void> {
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
    // trees. Agents / providers use raw `<slug>` subdirs with no marker,
    // so this guard alone doesn't cover them — that gap is the reason
    // scaffoldNewOrganization sources from the catalog now.
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
      await copyTree(src, dst);
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

    for (const domain of DOMAINS) {
      // Prefer the immutable builtin catalog (`*_BUILTIN_DIR`, set by the
      // platform Dockerfile and pushed into Convex's deployment env). Falls
      // back to the default org's writable dir when the env is unset — that
      // path is what local `bun dev` uses, where `examples/{domain}` *is*
      // the catalog. In prod the fallback also kicks in on rollback to a
      // pre-fix platform image (intentional graceful degradation back to
      // the prior behavior).
      const sourceDir =
        process.env[domain.builtinEnv] ?? domain.resolve('default');
      const targetDir = domain.resolve(args.orgSlug);

      const alreadyScaffolded = await dirHasFiles(targetDir);
      if (alreadyScaffolded) {
        console.warn(
          `[scaffoldNewOrganization] ${domain.name}: target ${targetDir} already has files, skipping`,
        );
        continue;
      }

      try {
        await copyTree(sourceDir, targetDir);
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
