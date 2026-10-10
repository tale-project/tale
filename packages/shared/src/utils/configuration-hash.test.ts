import { describe, expect, it } from 'vitest';

import { configurationHash } from './configuration-hash';
import {
  CONFIGURATION_HASH_GOLDEN,
  NULL_DIGEST,
} from './configuration-hash.golden';
import { computeContentHash } from './hashing';
import { stableStringify } from './stable-stringify';

describe('configurationHash', () => {
  it.each(CONFIGURATION_HASH_GOLDEN)(
    '%s keeps its golden digest',
    (_name, value, digest) => {
      expect(configurationHash(value)).toBe(digest);
    },
  );

  it('is the SHA-256 of the key-sorted JSON', () => {
    const value = { b: [true, null], a: { d: 1, c: 'x' } };
    expect(stableStringify(value)).toBe(
      '{"a":{"c":"x","d":1},"b":[true,null]}',
    );
    expect(configurationHash(value)).toBe(
      computeContentHash('{"a":{"c":"x","d":1},"b":[true,null]}'),
    );
  });

  it('never depends on key order', () => {
    expect(configurationHash({ a: 1, b: { c: 2, d: [3] } })).toBe(
      configurationHash({ b: { d: [3], c: 2 }, a: 1 }),
    );
  });

  it('hashes null like any other value; absence is the caller’s convention', () => {
    expect(configurationHash(null)).toBe(NULL_DIGEST);
  });

  it('writes what JSON cannot hold as null, the way the platform always has', () => {
    expect(configurationHash(undefined)).toBe(NULL_DIGEST);
    expect(configurationHash({ a: undefined })).toBe(
      configurationHash({ a: null }),
    );
    expect(configurationHash([1, undefined, () => 1])).toBe(
      configurationHash([1, null, null]),
    );
    // An undefined member is kept as null, so it is not the same as absent.
    expect(configurationHash({ a: undefined })).not.toBe(configurationHash({}));
  });
});
