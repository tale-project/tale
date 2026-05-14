/**
 * Deterministic JSON emit.
 *
 * Writes a `FixtureFile` to disk with stable key order and trailing
 * newline so `git diff` is clean across runs. The generator is
 * idempotent: same seed + same datasets → byte-identical output. CI's
 * `fixtures:verify` job hashes the output to detect drift.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FixtureCase, FixtureFile } from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Where fixtures land — pinned relative to this file. */
const FIXTURES_ROOT = join(__dirname, '..', '..', 'test', 'fixtures');

interface EmitArgs {
  locale: string;
  generator: string;
  seed: number;
  datasetsVersion: Record<string, string>;
  positives: FixtureCase[];
  negatives: FixtureCase[];
  generatedAt: string;
}

/**
 * `JSON.stringify(value, replacer, 2)` is already deterministic for keys
 * inserted in the right order — V8's iteration order matches insertion
 * order. The replacer just enforces a stable key sequence on case objects
 * (`id`, `input`, `expected`) so a programmer who writes the literal in a
 * different order doesn't shift the output.
 */
function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  // Probe via `in` operator rather than narrowing — the safer alternative
  // to a `Record<string, unknown>` cast (which oxlint rightly flags as a
  // widening assertion).
  if ('id' in value && 'input' in value && 'expected' in value) {
    const id = (value as { id: unknown }).id;
    const input = (value as { input: unknown }).input;
    const expected = (value as { expected: unknown }).expected;
    if (typeof id === 'string' && Array.isArray(expected)) {
      return { id, input, expected };
    }
  }
  return value;
}

export function emitFixtures(args: EmitArgs): {
  positivesPath: string;
  negativesPath: string;
} {
  const dir = join(FIXTURES_ROOT, args.locale);
  mkdirSync(dir, { recursive: true });

  const buildFile = (
    cases: FixtureCase[],
    kind: 'positives' | 'negatives',
  ): FixtureFile => ({
    _meta: {
      locale: args.locale,
      generator: args.generator,
      seed: args.seed,
      datasets: args.datasetsVersion,
      counts: {
        positives: kind === 'positives' ? cases.length : 0,
        negatives: kind === 'negatives' ? cases.length : 0,
      },
      generatedAt: args.generatedAt,
    },
    [kind]: cases,
  });

  const posFile = buildFile(args.positives, 'positives');
  const negFile = buildFile(args.negatives, 'negatives');

  const positivesPath = join(dir, 'positives.json');
  const negativesPath = join(dir, 'negatives.json');

  writeFileSync(
    positivesPath,
    JSON.stringify(posFile, stableReplacer, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    negativesPath,
    JSON.stringify(negFile, stableReplacer, 2) + '\n',
    'utf8',
  );

  return { positivesPath, negativesPath };
}
