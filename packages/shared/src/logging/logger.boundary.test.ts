/**
 * Convex V8 boundary guard.
 *
 * `@tale/shared/logging/logger` and `@tale/shared/terminal` are imported into the
 * Convex bundler (V8). If either ever reaches a `node:*` runtime module or
 * `Bun.spawn` — directly or transitively — `bun run dev`'s Convex push breaks
 * with `Could not resolve "node:*"`. This test walks each entry point's relative
 * import graph and fails on a node-only dependency, so the boundary is enforced
 * mechanically rather than by convention.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Resolve a relative import specifier to an on-disk `.ts` file. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = base.endsWith('.ts')
    ? [base]
    : [`${base}.ts`, `${base}/index.ts`];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      // Not this candidate — try the next resolution shape.
    }
  }
  return null;
}

const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

/** Collect the transitive set of local files reachable from `entry`. */
function collectGraph(entry: string): Map<string, string> {
  const graph = new Map<string, string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || graph.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    graph.set(file, source);
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const resolved = resolveSpecifier(file, match[1]);
      if (resolved && !graph.has(resolved)) stack.push(resolved);
    }
  }
  return graph;
}

// Banned node runtime modules. We match a VALUE import only — a type-only
// `import type { X } from 'node:fs'` erases at compile time and is harmless, so
// it must not trip the guard. `fs`/`os`/`path`/`process`/`stream` are included
// (beyond the original spawn/tty set) because any of them, value-imported, would
// also break the V8 bundle.
const NODE_RUNTIME_MODULE =
  /node:(child_process|tty|net|dgram|cluster|readline|worker_threads|fs|os|path|process|stream)/;

/** Does this source VALUE-import a banned node runtime module? */
function valueImportsNodeRuntime(source: string): string | null {
  for (const line of source.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // skip comments
    if (/\bimport\s+type\b/.test(line)) continue; // type-only import — erased
    const m = line.match(
      new RegExp(`from\\s+['"]${NODE_RUNTIME_MODULE.source}['"]`),
    );
    if (m) return line.trim();
  }
  return null;
}

// Every node-free island entry. `terminal/live` and `classify` are reachable
// from the Convex bundle conceptually (and via the shared barrels), so they must
// stay clean alongside `logger` and `terminal`.
const NODE_FREE_ENTRIES = [
  resolve(SRC, 'logging/logger.ts'),
  resolve(SRC, 'terminal/index.ts'),
  resolve(SRC, 'terminal/live.ts'),
  resolve(SRC, 'classify/index.ts'),
];

describe('Convex V8 import boundary', () => {
  for (const entry of NODE_FREE_ENTRIES) {
    it(`${entry.replace(SRC, '@/')} stays node-free`, () => {
      const graph = collectGraph(entry);
      for (const [file, source] of graph) {
        const offending = valueImportsNodeRuntime(source);
        expect(
          offending,
          `${file} value-imports a node runtime module: ${offending}`,
        ).toBeNull();
        expect(source, `${file} references Bun.spawn`).not.toContain(
          'Bun.spawn',
        );
        expect(
          file,
          `${file} reaches the CLI-only process subpath`,
        ).not.toMatch(/[\\/]process[\\/]/);
        expect(file, `${file} reaches the CLI-only tux subpath`).not.toMatch(
          /[\\/]tux[\\/]/,
        );
      }
    });
  }

  it('the logger reaches only itself + terminal/{capabilities,ansi}', () => {
    const graph = collectGraph(resolve(SRC, 'logging/logger.ts'));
    const reached = [...graph.keys()].map((f) => f.replace(`${SRC}/`, ''));
    for (const file of reached) {
      expect(
        /^logging\/|^terminal\/(capabilities|ansi|width|format)\.ts$/.test(
          file,
        ),
        `logger unexpectedly reaches ${file}`,
      ).toBe(true);
    }
  });

  it('the guard actually detects a node dependency (positive control)', () => {
    const proc = readFileSync(
      resolve(SRC, 'process/spawn-captured.ts'),
      'utf8',
    );
    expect(valueImportsNodeRuntime(proc)).not.toBeNull();
  });
});
