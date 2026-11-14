// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  limitRate,
  RATE_LIMITS,
  setRateLimitClockForTests,
} from './rate-limit.ts';

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

describe('the rate-limit clock', () => {
  /** A database whose every statement answers `rows`, keeping the values
   * each one was given. */
  function fakeSql(rows: unknown[]) {
    const values: unknown[][] = [];
    const sql = vi.fn((_strings: TemplateStringsArray, ...args: unknown[]) => {
      values.push(args);
      return Promise.resolve(rows);
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template stand-in for the two statements limitRate writes
    return { sql: sql as unknown as Sql, values };
  }

  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('a charge reads the clock a test holds, and the wall clock after it is restored', async () => {
    restore = setRateLimitClockForTests(() => 1_000);
    const held = fakeSql([{ value: '1' }]);
    await limitRate(held.sql, 'automation:bench', { key: 'org:o', count: 1 });
    // The stamp the charge writes is the held instant, never the machine's.
    expect(held.values[0]).toContain(1_000);

    restore();
    restore = undefined;
    const before = Date.now();
    const wall = fakeSql([{ value: '1' }]);
    await limitRate(wall.sql, 'automation:bench', { key: 'org:o', count: 1 });
    expect(wall.values[0]).not.toContain(1_000);
    expect(
      wall.values[0]?.some(
        (value) => typeof value === 'number' && value >= before,
      ),
    ).toBe(true);
  });

  test('with no clock held, a charge reads Date.now as it is at the call, so a stub of it is read', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(7_000);
    try {
      const stubbed = fakeSql([{ value: '1' }]);
      await limitRate(stubbed.sql, 'automation:bench', {
        key: 'org:o',
        count: 1,
      });
      expect(stubbed.values[0]).toContain(7_000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('a refusal names the wait from the held clock: no time passes while it is held', async () => {
    restore = setRateLimitClockForTests(() => 60_000);
    // The UPSERT changes nothing (over the limit); the bucket was emptied at
    // this very instant, so the wait is the whole refill of the charge.
    const spent = vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('').includes('SELECT value::text')
          ? [{ value: '0', ts: '60000' }]
          : [],
      ),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template stand-in, as above
    const result = await limitRate(
      spent as unknown as Sql,
      'automation:bench',
      {
        key: 'org:o',
        count: 3,
      },
    );
    const rule = RATE_LIMITS['automation:bench'];
    expect(result).toEqual({
      ok: false,
      retryAfter: Math.ceil(3 / (rule.rate / rule.period)),
    });
  });
});
