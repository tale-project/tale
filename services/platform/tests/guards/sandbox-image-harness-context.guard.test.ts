// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The sandbox runtime image derives Gemini's system settings from the
 * platform's own harness interpreter: its `gemini-settings-build` stage runs
 * `services/sandbox-runtime/build-gemini-settings.ts`, which imports
 * `lib/harnesses/exec-builder.ts`, in a build context that
 * `services/sandbox-runtime/Dockerfile.dockerignore` cuts down to an
 * allow-list of single files. A module the interpreter starts importing and
 * the allow-list does not name is missing from the stage, and the image build
 * fails with "Cannot find module" — as it did once the exec builder took Pi's
 * RPC command from `parsers/pi-jsonl.ts`. This guard follows the runtime
 * imports of the settings build (type-only imports are erased and need no
 * file) and holds every platform file they reach to an allow-list entry.
 */

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const ENTRY = 'services/sandbox-runtime/build-gemini-settings.ts';
const DOCKERIGNORE = 'services/sandbox-runtime/Dockerfile.dockerignore';

/** The relative specifiers a module imports or re-exports at runtime. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const statement =
    /^(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+'(\.{1,2}\/[^']+)'/gms;
  for (const match of source.matchAll(statement)) {
    const clause = match[1] ?? '';
    // `import { type A, type B } from` carries no value either.
    const names = clause.match(/\{([^}]*)\}/)?.[1];
    if (
      names !== undefined &&
      !/\*|\bdefault\b/.test(clause.replace(/\{[^}]*\}/, '')) &&
      names
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .every((name) => name.startsWith('type '))
    ) {
      continue;
    }
    specifiers.push(match[2] ?? '');
  }
  for (const match of source.matchAll(/^import\s+'(\.{1,2}\/[^']+)'/gm)) {
    specifiers.push(match[1] ?? '');
  }
  return specifiers;
}

function resolveModule(from: string, specifier: string): string {
  const base = path.join(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(path.join(REPO, candidate)) && candidate.endsWith('.ts')) {
      return candidate;
    }
  }
  throw new Error(`${from} imports ${specifier}, which resolves to no file`);
}

/** Every repository file the entry reaches through runtime imports. */
function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const source = readFileSync(path.join(REPO, file), 'utf8');
    for (const specifier of runtimeImports(source)) {
      const target = resolveModule(file, specifier);
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen].sort();
}

describe('the sandbox image builds Gemini settings from files its context keeps', () => {
  it('names every platform module the settings build imports at runtime', () => {
    const closure = runtimeClosure(ENTRY).filter((file) =>
      file.startsWith('services/platform/'),
    );
    // The interpreter itself, at least: a closure that lost it would prove
    // nothing.
    expect(closure).toContain(
      'services/platform/lib/harnesses/exec-builder.ts',
    );
    const allowed = new Set(
      readFileSync(path.join(REPO, DOCKERIGNORE), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('!') && !line.endsWith('/'))
        .map((line) => line.slice(1)),
    );
    expect(closure.filter((file) => !allowed.has(file))).toEqual([]);
  });

  it('reads a type-only import as no runtime file', () => {
    expect(
      runtimeImports(
        "import type { A } from './a';\nimport { type B, type C } from './b';\nimport { d } from './d';\nimport {\n  e,\n  type F,\n} from './e';\n",
      ),
    ).toEqual(['./d', './e']);
  });
});
