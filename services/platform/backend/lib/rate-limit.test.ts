// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { RATE_LIMITS } from './rate-limit.ts';

/**
 * The catalog is the list of what IS limited. The 0.4 rules were ported as
 * data and most of them never found a door in 0.5 — a reader auditing limits
 * saw chat turns, tool dispatch and webhooks "limited" while nothing charged
 * them. A rule is live when some module outside this file names it as a
 * string literal (`limitRate(sql, 'file:upload', …)`); names are never built
 * dynamically, so a literal search is exact.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(HERE, '..', '..');
const CATALOG = path.join(HERE, 'rate-limit.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts') && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function chargedNames(): Set<string> {
  const charged = new Set<string>();
  for (const root of ['backend', 'lib']) {
    for (const file of sourceFiles(path.join(PLATFORM, root))) {
      if (file === CATALOG) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/'([a-z][\w-]*(?::[\w-]+)+)'/g)) {
        if (match[1] !== undefined) charged.add(match[1]);
      }
    }
  }
  return charged;
}

describe('the rate-limit catalog', () => {
  test('every rule is charged by a door outside the catalog', () => {
    const charged = chargedNames();
    const dead = Object.keys(RATE_LIMITS).filter((name) => !charged.has(name));
    expect(
      dead,
      `RATE_LIMITS declares rules nothing charges — delete the rule, or wire the charge at its door: ${dead.join(', ')}`,
    ).toEqual([]);
  });

  test('the literal search sees a rule a door does charge', () => {
    // The guard above would pass vacuously if the scan matched nothing; the
    // upload door has charged this rule since the files port.
    expect(chargedNames().has('file:upload')).toBe(true);
  });
});
