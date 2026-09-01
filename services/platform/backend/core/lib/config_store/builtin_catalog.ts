'use node';

/**
 * Resolution of the built-in per-org seed catalog root — the directory whose
 * children are the scaffoldable config domains (`governance/`, …).
 *
 * Resolution order, first hit wins:
 *
 *   1. `$TALE_CONFIG_BUILTIN_DIR` (absolute) — the deployment contract.
 *      Production bakes the catalog into the image (Dockerfile), dev-engine
 *      and the E2E harness point it at their fixture trees. A set-but-
 *      relative value is a misconfiguration and resolves to nothing rather
 *      than being guessed at.
 *   2. The repo checkout's `configs/platform/custom/`, found by walking up
 *      from the working directory — covers repo-local contexts that run
 *      without the env (vitest worlds, ad-hoc scripts, a source checkout's
 *      convex dev process). `configs/platform/system/` is deliberately NOT
 *      part of this root: system config is org-independent and never
 *      scaffolded into org trees.
 *
 * Shipped containers carry no repo checkout, so step 2 never fires there —
 * the env stays the only truth in production.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

/** Repo-relative location of the per-org seed catalog. */
const REPO_CUSTOM_CATALOG = ['configs', 'platform', 'custom'] as const;

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/** Walk up from `startDir` looking for `configs/platform/custom/`. */
function findRepoCatalog(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ...REPO_CUSTOM_CATALOG);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the built-in catalog root per the order documented above, or
 * `null` when neither source is available (callers refuse loudly — there is
 * no fallback to any org's live tree).
 */
export function resolveBuiltinCatalogRoot(): string | null {
  const fromEnv = process.env.TALE_CONFIG_BUILTIN_DIR;
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : null;
  }
  return findRepoCatalog(process.cwd());
}
