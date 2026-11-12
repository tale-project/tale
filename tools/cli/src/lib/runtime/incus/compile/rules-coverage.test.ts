import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileInput } from './compile-fixture';
import { RULES } from './rules';
import { compileStackTarget } from './stack-target';

/**
 * The guard of design D-09: every key of `ComposeService`
 * (`lib/compose/types.ts`) has a row in the translator's table, so a compose
 * key added for Docker cannot reach the Incus runtime without a decision.
 */

const TYPES = fileURLToPath(
  new URL('../../../compose/types.ts', import.meta.url),
);

/** The top-level keys of `interface ComposeService { … }`, from the source. */
function composeServiceKeys(): string[] {
  const source = readFileSync(TYPES, 'utf8');
  const start = source.indexOf('export interface ComposeService {');
  expect(start, 'ComposeService is declared in types.ts').toBeGreaterThan(-1);
  const keys: string[] = [];
  let depth = 0;
  for (const line of source.slice(start).split('\n').slice(1)) {
    const trimmed = line.trim();
    if (depth === 0 && trimmed === '}') break;
    const key = depth === 0 ? /^([a-z_]+)\??:/.exec(trimmed)?.[1] : undefined;
    if (key) keys.push(key);
    for (const char of trimmed.replace(/\/\/.*$/, '')) {
      if (char === '{' || char === '(' || char === '[') depth += 1;
      if (char === '}' || char === ')' || char === ']') depth -= 1;
    }
  }
  return keys;
}

describe('the translator table covers every compose key', () => {
  test('the guard reads the keys of ComposeService', () => {
    const keys = composeServiceKeys();
    expect(keys).toContain('image');
    expect(keys).toContain('healthcheck');
    expect(keys).toContain('runtime');
    expect(keys.length).toBeGreaterThan(20);
  });

  test('every ComposeService key has exactly one rule', () => {
    const missing = composeServiceKeys().filter(
      (key) => !Object.hasOwn(RULES, key),
    );
    expect(missing, 'add a row to compile/rules.ts for each').toEqual([]);
  });

  test('every rule says what it does', () => {
    for (const [key, rule] of Object.entries(RULES)) {
      expect(['map', 'ignore', 'refuse'], key).toContain(rule.action);
      expect(rule.rule.length, key).toBeGreaterThan(10);
    }
  });

  test('a key without a row is refused, never passed through', () => {
    const result = compileStackTarget(
      compileInput('managed', [
        {
          compose: {
            services: {
              db: {
                image: 'ghcr.io/tale-project/tale/tale-db:0.5.95',
                volumes: ['db-data:/var/lib/postgresql/data'],
                healthcheck: { disable: true },
                tmpfs: ['/run'],
              },
            },
          },
        },
      ]),
    );
    expect(result.refusals).toContainEqual(
      expect.objectContaining({ id: 'no-rule', service: 'db', key: 'tmpfs' }),
    );
  });

  test('a refused key is refused with its reason', () => {
    for (const [key, rule] of Object.entries(RULES)) {
      if (rule.action !== 'refuse') continue;
      const result = compileStackTarget(
        compileInput('managed', [
          {
            compose: {
              services: {
                db: {
                  image: 'ghcr.io/tale-project/tale/tale-db:0.5.95',
                  volumes: ['db-data:/var/lib/postgresql/data'],
                  healthcheck: { disable: true },
                  [key]: 'set',
                },
              },
            },
          },
        ]),
      );
      expect(result.refusals, key).toContainEqual(
        expect.objectContaining({ id: 'refused-key', service: 'db', key }),
      );
    }
  });
});
