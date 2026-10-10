// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The engine's layering, enforced: `core/` and `api/` are pure — no `node:*`
 * builtins, no Bun globals, no Convex modules — so the exact same code runs
 * under any host (Convex actions, Bun scripts, tests) and every side effect
 * flows through the slots. The backends under `runners/` are the ONE
 * sanctioned exception — `node-vm.ts` exists to wrap `node:vm` and to
 * supervise the child process (`node-vm-child.ts`) it evaluates in; test
 * files and the test-support modules under `selftest/` are host code and
 * exempt.
 */

const ENGINE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** The platform workspace, which sanctioned modules are named from. */
const PLATFORM_ROOT = path.resolve(ENGINE_ROOT, '..', '..');

const PURE_DIRS = ['core', 'api'];
const PURE_SHARED_HELPERS = [
  path.resolve(
    ENGINE_ROOT,
    '../../../../packages/shared/src/automation-name.ts',
  ),
  path.resolve(
    ENGINE_ROOT,
    '../../../../packages/shared/src/automation-replay.ts',
  ),
  path.resolve(ENGINE_ROOT, '../shared/utils/stable-stringify.ts'),
  path.resolve(ENGINE_ROOT, '../shared/utils/bound-json.ts'),
  path.resolve(ENGINE_ROOT, '../shared/utils/storable-text.ts'),
  path.resolve(ENGINE_ROOT, '../shared/audit-redaction.ts'),
];

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
  // Extracting a helper must not hide it from the host-dependency guards.
  const files = [
    ...PURE_DIRS.flatMap((d) => sourceFiles(path.join(ENGINE_ROOT, d))),
    ...PURE_SHARED_HELPERS,
  ];

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
    // ajv (schema validation), the parser stack (acorn, its ESTree types,
    // periscopic scopes, the zimmerframe walker, is-reference), jsdiff's line
    // diff (the unified patch between two versions), the shared safe YAML
    // loader, type guards, name grammar, stable serializer, JSON bounding and
    // the secret-key list are runtime-neutral, and so is
    // `@tale/ui`'s data core (summaries, shapes, diffs, pointers, hashes),
    // whose own guard (`packages/ui/src/data/pure.test.ts`) holds it to
    // imports of itself, and its line diff (`code-diff/compute`, the one
    // unified patch), which its test holds to jsdiff alone; everything
    // else outside the engine tree is a layering violation.
    const allowedPackages = new Set([
      'ajv',
      '@tale/shared/automation-name',
      '@tale/shared/automation-replay',
      '@tale/ui/code-diff/compute',
      '@tale/ui/data/hash',
      '@tale/ui/data/infer-schema',
      '@tale/ui/data/json-pointer',
      '@tale/ui/data/stable-stringify',
      '@tale/ui/data/value-diff',
      '@tale/ui/data/value-summary',
      'acorn',
      'diff',
      'estree',
      'is-reference',
      'periscopic',
      'zimmerframe',
    ]);
    const allowedModules = [
      path.join('lib', 'shared', 'config', 'yaml'),
      path.join('lib', 'utils', 'type-utils'),
      path.join('lib', 'shared', 'utils', 'stable-stringify'),
      path.join('lib', 'shared', 'utils', 'bound-json'),
      path.join('lib', 'shared', 'utils', 'storable-text'),
      path.join('lib', 'shared', 'audit-redaction'),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const s of importsOf(f)) {
        if (s.startsWith('.')) {
          const resolved = path
            .resolve(path.dirname(f), s)
            .replace(/\.ts$/, '');
          const insideEngine = resolved.startsWith(ENGINE_ROOT + path.sep);
          const sanctioned = allowedModules.some(
            (m) => resolved === path.join(PLATFORM_ROOT, m),
          );
          if (!insideEngine && !sanctioned) offenders.push(`${f} → ${s}`);
        } else if (!allowedPackages.has(s)) {
          offenders.push(`${f} → ${s}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the analysis layers stay browser-safe: they never reach Ajv', () => {
    // The editor runs the parser, typing and analysis layers — and the
    // document diff, which rings what another window changed — in the
    // browser, where the Content-Security-Policy forbids the code generation
    // Ajv compiles schemas with. Ajv-based checks live in `validate/` only,
    // so nothing these layers import — directly or through another engine
    // module — may load it.
    const browserSafe = ['syntax', 'typing', 'analysis', 'diff']
      .map((d) => path.join(ENGINE_ROOT, 'core', d))
      .filter((d) => existsSync(d))
      .flatMap((d) => sourceFiles(d));
    // A test's bench is planned, its expectations compared and a run that
    // was never stored read in the editor as well.
    browserSafe.push(
      path.join(ENGINE_ROOT, 'core', 'execute', 'bench.ts'),
      path.join(ENGINE_ROOT, 'core', 'record', 'transient.ts'),
      path.join(ENGINE_ROOT, 'core', 'test-limits.ts'),
      path.join(ENGINE_ROOT, 'api', 'expect.ts'),
    );
    expect(browserSafe.length).toBeGreaterThan(0);
    const resolveModule = (from: string, spec: string): string | null => {
      const target = path.resolve(path.dirname(from), spec);
      for (const candidate of [`${target}.ts`, path.join(target, 'index.ts')]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };
    const reached = new Set<string>();
    const pending = [...browserSafe];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const next = resolveModule(file, spec);
        if (next !== null) pending.push(next);
      }
    }
    const offenders = [...reached].filter((f) =>
      importsOf(f).some((s) => s === 'ajv' || s.startsWith('ajv/')),
    );
    expect(offenders).toEqual([]);
  });

  it('the MCP tool inventory loads none of the engine behind the methods', () => {
    // The settings page lists the MCP tools from lib/mcp/tools.ts; the
    // method names it needs are a leaf, so the page never downloads the
    // parser, the schema validator or the YAML loader to show a list.
    const resolveModule = (from: string, spec: string): string | null => {
      const target = path.resolve(path.dirname(from), spec);
      for (const candidate of [`${target}.ts`, path.join(target, 'index.ts')]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };
    const reached = new Set<string>();
    const pending = [path.resolve(ENGINE_ROOT, '../mcp/tools.ts')];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const next = resolveModule(file, spec);
        if (next !== null) pending.push(next);
      }
    }
    expect(reached.size).toBeGreaterThan(1);
    const heavy = new Set(['acorn', 'ajv', 'yaml', 'periscopic']);
    const offenders = [...reached].filter((f) =>
      importsOf(f).some((s) => heavy.has(s)),
    );
    expect(offenders).toEqual([]);
  });

  it('the node-vm runner is the only module touching node:vm', () => {
    const runnerDir = path.join(ENGINE_ROOT, 'runners');
    const nodeImportsByFile = Object.fromEntries(
      sourceFiles(runnerDir).map((f) => [
        path.basename(f),
        importsOf(f)
          .filter((s) => s.startsWith('node:'))
          .sort(),
      ]),
    );
    // The supervisor forks and talks to its child; the child wraps node:vm;
    // the sandbox-exec backend reaches nothing on the host at all.
    expect(nodeImportsByFile).toEqual({
      'node-vm-child.ts': ['node:vm'],
      'node-vm.ts': ['node:child_process', 'node:net', 'node:url', 'node:vm'],
      'sandbox-exec.ts': [],
    });
  });
});
