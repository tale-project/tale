// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The engine's layering, enforced: `core/`, `api/`, and `store/` are pure —
 * no `node:*` builtins, no Bun globals, no Convex modules — so the exact
 * same code runs under any host (Convex actions, Bun scripts, tests) and
 * every side effect flows through the slots. `runners/node-vm.ts` is the ONE
 * sanctioned exception (it exists to wrap `node:vm`); test files are host
 * code and exempt.
 */

const ENGINE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const PURE_DIRS = ['core', 'api', 'store'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('engine purity', () => {
  const files = PURE_DIRS.flatMap((d) =>
    sourceFiles(path.join(ENGINE_ROOT, d)),
  );

  it('covers a non-trivial module set', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it('pure layers import no node builtins', () => {
    const offenders = files.filter((f) =>
      importsOf(f).some((s) => s.startsWith('node:') || s === 'bun'),
    );
    expect(offenders).toEqual([]);
  });

  it('pure layers import nothing from convex', () => {
    const offenders = files.filter((f) =>
      importsOf(f).some(
        (s) => s.startsWith('convex') || s.includes('_generated'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('pure layers reach outside the engine only for sanctioned pure helpers', () => {
    // ajv (schema validation), the shared safe YAML loader, and the shared
    // type-guard helpers are all runtime-neutral; everything else outside
    // the engine tree is a layering violation.
    const allowedPackages = new Set(['ajv']);
    const allowedModules = [
      path.join('lib', 'shared', 'config', 'yaml'),
      path.join('lib', 'utils', 'type-utils'),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const s of importsOf(f)) {
        if (s.startsWith('.')) {
          const resolved = path.resolve(path.dirname(f), s);
          const insideEngine = resolved.startsWith(ENGINE_ROOT);
          const sanctioned = allowedModules.some((m) => resolved.endsWith(m));
          if (!insideEngine && !sanctioned) offenders.push(`${f} → ${s}`);
        } else if (!allowedPackages.has(s)) {
          offenders.push(`${f} → ${s}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the node-vm runner is the only module touching node:vm', () => {
    const runnerDir = path.join(ENGINE_ROOT, 'runners');
    const runnerImports = sourceFiles(runnerDir).flatMap((f) =>
      importsOf(f).filter((s) => s.startsWith('node:')),
    );
    expect(runnerImports).toEqual(['node:vm']);
  });
});
