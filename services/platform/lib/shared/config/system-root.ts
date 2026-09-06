/**
 * Where the shipped, org-independent system catalog lives —
 * `configs/platform/system/` in a checkout, `$TALE_CONFIG_SYSTEM_DIR` in a
 * shipped container.
 *
 * Every reader of that tree (providers/models/harnesses, connectors, the
 * pii data tree) resolves its root through this one function, so the
 * deployment contract cannot drift between them: a container has no repo
 * checkout to walk up to, and a reader that only knows the walk-up finds
 * nothing there and silently runs on empty data.
 *
 * Resolution order:
 *  1. an explicit `root` (callers pass the baked-in path);
 *  2. `$TALE_CONFIG_SYSTEM_DIR` when set to an ABSOLUTE path — a set-but-
 *     relative value is a misconfiguration and resolves to nothing (mirrors
 *     the builtin-catalog convention) rather than being guessed against the
 *     cwd;
 *  3. the repo walk-up from the working directory — covers vitest, scripts,
 *     and a source checkout's dev process.
 *
 * Node-side only (it stats the filesystem); never import it from V8 or
 * browser code.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

/** Repo-relative location of the shipped system config tree. */
const REPO_SYSTEM_CONFIG_ROOT = ['configs', 'platform', 'system'] as const;

/** The environment variable a shipped container points at the baked tree. */
const SYSTEM_CONFIG_DIR_ENV = 'TALE_CONFIG_SYSTEM_DIR';

export interface ResolveSystemConfigRootOptions {
  /** Absolute path of the `system/` directory; wins over everything else. */
  readonly root?: string;
  /** Environment to read `TALE_CONFIG_SYSTEM_DIR` from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the repo walk-up starts. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    // A missing path is the ordinary walk-up miss, not an error.
    return false;
  }
}

/** `$TALE_CONFIG_SYSTEM_DIR` when it is set to an absolute path. */
export function systemConfigRootFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const fromEnv = env[SYSTEM_CONFIG_DIR_ENV];
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return undefined;
}

/** Walk up from `startDir` to the checkout's `configs/platform/system`. */
export function findRepoSystemConfigRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ...REPO_SYSTEM_CONFIG_ROOT);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the system catalog root, or null when no source yields one. The
 * caller owns the error message — each reader names itself and what it
 * needed, so the log says which catalog is missing.
 */
export function resolveSystemConfigRoot(
  options: ResolveSystemConfigRootOptions = {},
): string | null {
  return (
    options.root ??
    systemConfigRootFromEnv(options.env) ??
    findRepoSystemConfigRoot(options.cwd ?? process.cwd())
  );
}

/**
 * The one sentence every reader appends when resolution fails — so an
 * operator reading any of the three messages learns the same remedy.
 */
export const SYSTEM_CONFIG_ROOT_REMEDY = `set ${SYSTEM_CONFIG_DIR_ENV} (absolute), pass an explicit root, or run inside a checkout with ${REPO_SYSTEM_CONFIG_ROOT.join('/')}`;
