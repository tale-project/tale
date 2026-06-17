#!/usr/bin/env bun
/**
 * Make Convex `node.externalPackages` (convex.json) resolvable from
 * `services/platform/node_modules`.
 *
 * WHY: In this bun workspace, dependencies are hoisted to the repo-root
 * `node_modules`. Convex's bundler only marks a package external when it
 * physically resolves to `node_modules/<pkg>` *next to the parent package.json*
 * (see convex `bundler/external.js` → `computeExternalPackages`: it joins
 * `dirname(package.json)/node_modules/<pkg>` and skips the package entirely if
 * that path doesn't exist). Because the hoisted packages live in the root
 * `node_modules`, the existence check fails, nothing is externalized, and the
 * heavy node-only libs (jsdom→canvas native binding, pdfjs DOM globals, …) get
 * bundled inline — which breaks the push (`Could not resolve canvas.node`,
 * `Failed to analyze …: ENOENT default-stylesheet.css`, module-size) and
 * inflates the upload.
 *
 * FIX: symlink each external package from wherever it is hoisted into
 * `services/platform/node_modules/<pkg>` so Convex's resolution + path-equality
 * check succeed. Idempotent; safe to run before every local `convex dev`
 * (invoked from scripts/dev.ts). NOTE: only needed for the workspace layout —
 * the Docker platform image runs `convex deploy` from `/app`, where the
 * externals already sit in the sibling `/app/node_modules`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const platformDir = dirname(dirname(fileURLToPath(import.meta.url)));
const convexJsonPath = join(platformDir, 'convex.json');

interface ConvexConfig {
  node?: { externalPackages?: string[] };
}

/** Walk up from `startDir` looking for `node_modules/<pkg>`. */
function findHoisted(pkg: string, startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', pkg);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let externalPackages: string[] = [];
try {
  const config = JSON.parse(
    readFileSync(convexJsonPath, 'utf8'),
  ) as ConvexConfig;
  externalPackages = config.node?.externalPackages ?? [];
} catch (err) {
  console.warn(
    `[link-convex-externals] Could not read ${convexJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(0);
}

const localModules = join(platformDir, 'node_modules');
let linked = 0;
for (const pkg of externalPackages) {
  const dest = join(localModules, pkg);
  if (existsSync(dest)) continue; // already present (real install or prior symlink)

  // Start the search one level up so we don't re-find the missing local path.
  const source = findHoisted(pkg, dirname(platformDir));
  if (!source) {
    // Not hoisted anywhere reachable — it will be bundled inline. Fine for
    // pure-JS packages; only the native/fs ones strictly need the symlink.
    continue;
  }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    // Guard against a dangling symlink left behind by a previous run.
    if (lstatSync(dest, { throwIfNoEntry: false })) continue;
    symlinkSync(source, dest, 'dir');
    linked++;
  } catch (err) {
    console.warn(
      `[link-convex-externals] Failed to link ${pkg}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

if (linked > 0) {
  console.log(
    `[link-convex-externals] Linked ${linked} Convex external package(s) into services/platform/node_modules`,
  );
}
