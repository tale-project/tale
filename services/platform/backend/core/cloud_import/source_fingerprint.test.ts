// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { isSourceUnchanged, sourceFingerprint } from './source_fingerprint';

describe('sourceFingerprint', () => {
  it('keys on size + modified stamp, and only with both', () => {
    expect(sourceFingerprint({ size: 10, modifiedAt: 1700000000000 })).toBe(
      '10:1700000000000',
    );
    expect(sourceFingerprint({ size: 10 })).toBeUndefined();
    expect(sourceFingerprint({ modifiedAt: 1700000000000 })).toBeUndefined();
    expect(
      sourceFingerprint({ size: 10, modifiedAt: Number.NaN }),
    ).toBeUndefined();
  });
});

describe('isSourceUnchanged', () => {
  it('compares by hash when the vendor sent one', () => {
    expect(
      isSourceUnchanged({
        hash: 'h1',
        storedHash: 'h1',
        fingerprint: '1:1',
        storedFingerprint: '2:2',
      }),
    ).toBe(true);
    expect(
      isSourceUnchanged({
        hash: 'h2',
        storedHash: 'h1',
        fingerprint: '1:1',
        storedFingerprint: '1:1',
      }),
    ).toBe(false);
  });

  it('falls back to the stamped fingerprint without a hash', () => {
    expect(
      isSourceUnchanged({
        hash: undefined,
        storedHash: 'h1',
        fingerprint: '1:1',
        storedFingerprint: '1:1',
      }),
    ).toBe(true);
    expect(
      isSourceUnchanged({
        hash: undefined,
        storedHash: undefined,
        fingerprint: '1:1',
        storedFingerprint: undefined,
      }),
    ).toBe(false);
    expect(
      isSourceUnchanged({
        hash: '',
        storedHash: undefined,
        fingerprint: undefined,
        storedFingerprint: undefined,
      }),
    ).toBe(false);
  });
});
