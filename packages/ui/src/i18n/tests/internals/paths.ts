/**
 * Path resolvers. Every helper is parameterised — no module-level constants
 * that bake in a specific repo layout.
 */

import path from 'node:path';

/** Resolve repo root from a service root. Assumes the service sits exactly
 *  two levels below the repo root (e.g., `<repo>/services/<name>` or
 *  `<repo>/packages/<name>`), matching the npm workspaces layout. */
export function resolveRepoRoot(serviceRoot: string): string {
  return path.resolve(serviceRoot, '..', '..');
}
