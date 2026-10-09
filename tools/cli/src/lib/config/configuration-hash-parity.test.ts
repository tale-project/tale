import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { configurationHash } from '@tale/shared/utils/configuration-hash';

import {
  CONFIGURATION_HASH_GOLDEN as GOLDEN,
  NULL_DIGEST,
} from '../../../../../packages/shared/src/utils/configuration-hash.golden';
import { managedConfigurationHash } from '../../../../../services/platform/backend/core/lib/config_store/value_hash';
import { valueHash } from './releases/identity';

/** The CLI keeps its own digest (`valueHash`, which refuses a value JSON
 * cannot hold) for its releases, plans and receipts; the platform and the
 * shared resource model use `configurationHash`. Both must agree on every
 * JSON value, or a CLI plan would stop matching the platform's `hash`. */
describe('configuration hash parity', () => {
  test.each(GOLDEN)(
    '%s hashes to its golden digest',
    (_name, value, digest) => {
      expect(valueHash(value)).toBe(digest);
      expect(managedConfigurationHash(value)).toBe(digest);
      expect(configurationHash(value)).toBe(digest);
    },
  );

  test('key order never changes a digest', () => {
    const forwards = { a: 1, b: { c: [1, 2], d: 'x' } };
    const backwards = { b: { d: 'x', c: [1, 2] }, a: 1 };
    for (const hash of [valueHash, managedConfigurationHash, configurationHash])
      expect(hash(backwards)).toBe(hash(forwards));
  });

  test('null is a digest for the CLI and an absent resource for the platform', () => {
    expect(valueHash(null)).toBe(NULL_DIGEST);
    expect(configurationHash(null)).toBe(NULL_DIGEST);
    expect(managedConfigurationHash(null)).toBeNull();
  });

  test('they part only on what JSON cannot hold: the CLI refuses, the platform writes null', () => {
    for (const [value, asNull] of [
      [undefined, null],
      [{ a: undefined }, { a: null }],
      [
        [1, undefined],
        [1, null],
      ],
    ] as const) {
      expect(() => valueHash(value)).toThrow('not JSON serializable');
      expect(configurationHash(value)).toBe(valueHash(asNull));
      expect(managedConfigurationHash(value)).toBe(valueHash(asNull));
    }
  });

  test('CLI cache inputs include both native JSON identity modules used by the parity proof', async () => {
    const turbo: unknown = JSON.parse(
      await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'),
    );
    expect(turbo).toMatchObject({
      tasks: {
        test: {
          inputs: expect.arrayContaining([
            '$TURBO_ROOT$/services/platform/backend/core/lib/config_store/value_hash.ts',
            '$TURBO_ROOT$/services/platform/lib/shared/utils/stable-stringify.ts',
          ]),
        },
      },
    });
  });
});
