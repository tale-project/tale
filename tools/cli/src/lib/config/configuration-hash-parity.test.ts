import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { managedConfigurationHash } from '../../../../../services/platform/backend/core/lib/config_store/value_hash';
import { valueHash } from './releases/identity';

/** One corpus, one digest each. The CLI's plans, receipts and releases and
 * the platform's native preconditions (`hash` / `expectedHash`) were recorded
 * with these two functions, so every digest here is a promise: no refactor
 * may move one of them. */
const GOLDEN: readonly (readonly [string, unknown, string])[] = [
  [
    'true',
    true,
    'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b',
  ],
  [
    'false',
    false,
    'fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa',
  ],
  [
    'zero',
    0,
    '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9',
  ],
  [
    'negative zero',
    -0,
    '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9',
  ],
  [
    'integer',
    42,
    '73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049',
  ],
  [
    'negative',
    -7,
    'a770d3270c9dcdedf12ed9fd70444f7c8a95c26cae3cae9bd867499090a2f14b',
  ],
  [
    'fraction',
    1.5,
    '9f29a130438b81170b92a42650f9a94291ecad60bd47af2a3886e75f7f728725',
  ],
  [
    'exponent',
    1e21,
    '241c4643fa70b1dcde1205b71be4e3bebb17e9f880c8e1a33d0ead6c27271d3c',
  ],
  [
    'tiny',
    1e-7,
    '5b33e02f2c5103a05d32f6ba9cb058294452bfbf393967f68bb30c1bdcbbab22',
  ],
  [
    'beyond the safe integers',
    2 ** 53 + 2,
    '25aa68783313802627958889943e895749ac4c0c7469b2a305cd450a12120768',
  ],
  [
    'not a number (serialized as null)',
    Number.NaN,
    '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  ],
  [
    'empty string',
    '',
    '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126',
  ],
  [
    'unicode string',
    ' café 😺 ',
    '9bfcef4d1b3e38e1ce77febf76a0c69402483d4887dff28b8dd217c333bf4e36',
  ],
  [
    'escapes',
    'line\nbreak "quoted" \\   \u0000',
    '76da2c85724e3ff3927a2d4a02792a2324cc8c77c240f9645b711f3dd851eb3e',
  ],
  [
    'empty array',
    [],
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  ],
  [
    'empty object',
    {},
    '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  ],
  [
    'numeric keys and nested arrays',
    { '10': 1, '2': ['x', { z: true, a: null }], '1': { '20': 2, '3': 3 } },
    '2edb082bd557ed6017442ce17de049016bc7697d1226f0e581be4673545c8953',
  ],
  [
    'unsorted keys',
    { b: 1, a: [3, { d: null, c: 'x' }] },
    'b4a92c330fc01410911e683d5d03404eb28981a6e1d67f9cb1ae63ddc3d19947',
  ],
  [
    'unicode and empty keys',
    { é: 1, e: 2, Z: 3, '': 0 },
    '528bf91433a18ef395f2c7932427e6f6afa6cf4dd40e24af56640e70005d8fd9',
  ],
  [
    'a policy',
    {
      enabled: true,
      idleTimeoutMinutes: 45,
      rules: [{ scope: 'org', maxTokens: 1000 }],
    },
    '5c1093799a52bfe0671e5e3d7f3b204e7700ad17cd888115d4c2f075b00df2a1',
  ],
];

/** `null` is the one JSON value the two functions answer differently on
 * purpose: the platform's hash is a precondition, and a null precondition
 * means "the resource is absent". */
const NULL_DIGEST =
  '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b';

describe('configuration hash parity', () => {
  test.each(GOLDEN)(
    '%s hashes to its golden digest',
    (_name, value, digest) => {
      expect(valueHash(value)).toBe(digest);
      expect(managedConfigurationHash(value)).toBe(digest);
    },
  );

  test('key order never changes a digest', () => {
    const forwards = { a: 1, b: { c: [1, 2], d: 'x' } };
    const backwards = { b: { d: 'x', c: [1, 2] }, a: 1 };
    expect(valueHash(backwards)).toBe(valueHash(forwards));
    expect(managedConfigurationHash(backwards)).toBe(
      managedConfigurationHash(forwards),
    );
  });

  test('null is a digest for the CLI and an absent resource for the platform', () => {
    expect(valueHash(null)).toBe(NULL_DIGEST);
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
      expect(managedConfigurationHash(value)).toBe(
        value === undefined ? NULL_DIGEST : valueHash(asNull),
      );
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
