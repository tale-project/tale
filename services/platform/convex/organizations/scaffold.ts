'use node';

/**
 * Scaffold per-org filesystem config on organization creation.
 *
 * Copies /examples/{agents,providers,integrations,workflows}/ defaults
 * into the new org's subdir. Skips *.secrets.json (new org provides its
 * own secrets). Skips branding (intentionally global).
 *
 * Idempotent: if the target dir already contains files, skip that domain
 * with a warning rather than overwriting.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { resolveAgentsDir } from '../agents/file_utils';
import { resolveIntegrationsDir } from '../integrations/file_utils';
import { atomicWrite, atomicWriteBuffer } from '../lib/file_io';
import { resolveProvidersDir } from '../providers/file_utils';
import { resolveWorkflowsDir } from '../workflows/file_utils';

type DirResolver = (orgSlug: string) => string;

// Each domain's per-org dir convention differs — use the domain's own resolver.
const DOMAINS: Array<{ name: string; resolve: DirResolver }> = [
  { name: 'agents', resolve: resolveAgentsDir },
  { name: 'providers', resolve: resolveProvidersDir },
  { name: 'integrations', resolve: resolveIntegrationsDir },
  { name: 'workflows', resolve: resolveWorkflowsDir },
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
  } catch {
    return false;
  }
}

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
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
    if (SKIP_DIR_NAMES.has(name)) continue;
    if (shouldSkipFile(name)) continue;

    const src = path.join(sourceDir, name);
    const dst = path.join(targetDir, name);

    const info = await stat(src).catch(() => null);
    if (!info) continue;

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
      const sourceDir = domain.resolve('default');
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
