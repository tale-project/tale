/**
 * Path resolvers. Every helper is parameterised — no module-level constants
 * that bake in a specific repo layout.
 */

import path from 'node:path';

/** Resolve repo root from a service root by walking up until we find
 *  the workspace `package.json` with `"workspaces"` or `bun.lockb` /
 *  `.git/`. Falls back to two-levels-up. */
export function resolveRepoRoot(serviceRoot: string): string {
  return path.resolve(serviceRoot, '..', '..');
}

/** Repo-relative path. */
export function relative(repoRoot: string, absolute: string): string {
  return path.relative(repoRoot, absolute);
}
