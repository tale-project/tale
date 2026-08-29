/**
 * Convex runtime guard: a file under `convex/` that reaches a Node built-in
 * must declare `'use node'`, or the deploy fails and the app stops starting.
 *
 * Convex bundles EVERY file under `convex/` for its V8 runtime unless the file
 * itself says otherwise — regardless of who imports it. So a helper that only
 * node-side actions use is still bundled for V8, and if it reaches `node:fs`
 * or `node:path` the push fails with:
 *
 *   ✘ [ERROR] Could not resolve "node:path"
 *   ERROR Convex deploy failed (exit code: 1)
 *
 * Nothing else catches this. Format, lint, typecheck, knip and the whole test
 * suite pass, because every one of them runs under Node where the import
 * resolves. The failure surfaces only after a container build, as every
 * browser-test shard failing at once — which reads like a flaky suite rather
 * than a broken build.
 *
 * The walk follows LOCAL imports transitively, because the reach is usually
 * indirect: `convex/knowledge/pii_gate.ts` imports `lib/pii`, whose barrel
 * re-exports `data/loader.ts`, which imports `node:fs`. Only the first file in
 * that chain is under `convex/` and only it can carry the directive.
 *
 * Bare npm packages are NOT followed. A package that pulls Node in through its
 * own dependencies is a real hazard this cannot see; the `node:` prefix is the
 * unambiguous signal, and a guard that guesses at packages would cry wolf.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `import.meta.dir`: the latter is a Bun-ism and is
// undefined under vitest, which would break this module at import time in its
// own test.
const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CONVEX_ROOT = path.join(PLATFORM_ROOT, 'convex');

/** Directories whose contents are generated or vendored, never authored. */
const SKIP_DIRS = new Set(['_generated', 'node_modules']);

/**
 * Suffixes Convex does not deploy. A test may import `node:fs` freely — it
 * runs under Node and never reaches the bundle.
 */
const SKIP_SUFFIXES = ['.test.ts', '.test.tsx', '.testkit.ts', '.bench.ts'];

export function isDeployed(file: string): boolean {
  return !SKIP_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

/**
 * `import x from 'y'`, `export … from 'y'`, and `await import('y')`.
 *
 * `import type` / `export type` are deliberately NOT matched: TypeScript
 * erases them before anything is bundled, so `import type { IncomingMessage }
 * from 'node:http'` is not a hazard. Several files on main do exactly that and
 * deploy fine — a guard that flagged them would be wrong on day one and get
 * switched off.
 */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)[\s\S]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Declared node-side. Matches the directive on the first non-empty line. */
export function declaresUseNode(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use node['"]/.test(source);
}

export function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

/** Resolve a relative specifier to a file on disk, trying the usual endings. */
export function resolveLocal(
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this ending; try the next.
    }
  }
  return null;
}

/**
 * The chain from `file` to a `node:` import, or null when it reaches none.
 * Depth-first so the reported path is one a reader can follow; `seen` makes a
 * cycle terminate rather than recurse forever.
 */
export function nodeReach(
  file: string,
  seen: Set<string>,
  cache: Map<string, string[] | null>,
): string[] | null {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  if (seen.has(file)) return null;
  seen.add(file);

  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  for (const specifier of importsOf(source)) {
    if (specifier.startsWith('node:')) {
      const chain = [path.relative(PLATFORM_ROOT, file), specifier];
      cache.set(file, chain);
      return chain;
    }
    const next = resolveLocal(file, specifier);
    if (next === null) continue;
    const deeper = nodeReach(next, seen, cache);
    if (deeper !== null) {
      const chain = [path.relative(PLATFORM_ROOT, file), ...deeper];
      cache.set(file, chain);
      return chain;
    }
  }
  cache.set(file, null);
  return null;
}

/**
 * Every file under `root` that reaches a Node built-in without declaring
 * itself node-side, each with the import chain that gets there.
 */
export function findOffenders(root: string): {
  offenders: string[];
  checked: number;
  nodeSide: number;
} {
  const files = listTsFiles(root);
  const cache = new Map<string, string[] | null>();
  const offenders: string[] = [];
  let nodeSide = 0;

  for (const file of files) {
    if (!isDeployed(file)) continue;
    const source = readFileSync(file, 'utf8');
    if (declaresUseNode(source)) {
      nodeSide += 1;
      continue;
    }
    const chain = nodeReach(file, new Set(), cache);
    if (chain !== null) {
      offenders.push(
        `${chain[0]} reaches ${chain[chain.length - 1]}\n      via ${chain.join('\n        → ')}`,
      );
    }
  }
  return { offenders, checked: files.length, nodeSide };
}

function main(): void {
  const { offenders, checked, nodeSide } = findOffenders(CONVEX_ROOT);

  if (offenders.length > 0) {
    console.error(
      `[check-convex-runtime] FAILED — ${offenders.length} file(s) under convex/ reach a Node built-in without "use node".\n` +
        `Convex bundles them for its V8 runtime and the deploy will fail.\n  - ` +
        offenders.join('\n  - '),
    );
    process.exit(1);
  }
  console.log(
    `[check-convex-runtime] OK — ${checked} file(s) under convex/ checked, ${nodeSide} declared node-side, none reach Node built-ins undeclared.`,
  );
}

// Only when run as a script, so a test can import the pieces without the walk.
if (import.meta.main) main();
