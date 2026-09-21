import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CipherError, createTokenCipher, secretsMatch } from './crypto';

const key = () => randomBytes(32);

describe('createTokenCipher', () => {
  it('opens what it sealed', () => {
    const cipher = createTokenCipher(key());
    const token = 'sk-ant-oat01-not-a-real-token';
    expect(cipher.open(cipher.seal(token))).toBe(token);
  });

  it('seals the same value differently every time', () => {
    const cipher = createTokenCipher(key());
    expect(cipher.seal('token')).not.toBe(cipher.seal('token'));
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createTokenCipher(randomBytes(16))).toThrow(CipherError);
  });

  it('refuses a value another key sealed', () => {
    const sealed = createTokenCipher(key()).seal('token');
    expect(() => createTokenCipher(key()).open(sealed)).toThrow(CipherError);
  });

  it('refuses a tampered ciphertext rather than answering garbage', () => {
    const cipher = createTokenCipher(key());
    const [version, iv, tag, ciphertext] = cipher.seal('token').split('.');
    const flipped = `${ciphertext?.slice(0, -2) ?? ''}AA`;
    expect(() => cipher.open(`${version}.${iv}.${tag}.${flipped}`)).toThrow(
      CipherError,
    );
  });

  it('refuses a value that is not in the sealed format', () => {
    expect(() => createTokenCipher(key()).open('plain-text')).toThrow(
      CipherError,
    );
  });

  it('refuses a truncated authentication tag', () => {
    const cipher = createTokenCipher(key());
    const [version, iv, tag, ciphertext] = cipher.seal('token').split('.');
    // GCM accepts a 4-byte tag unless the length is pinned, and a 4-byte tag
    // is forgeable — so a short one must be refused before it is verified.
    const short = Buffer.from(tag ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(() =>
      cipher.open(`${version}.${iv}.${short}.${ciphertext}`),
    ).toThrow(CipherError);
  });
});

describe('secretsMatch', () => {
  it('accepts an exact match', () => {
    expect(secretsMatch('s3cret', 's3cret')).toBe(true);
  });

  it('rejects a different value of the same length', () => {
    expect(secretsMatch('s3cret', 's3crey')).toBe(false);
  });

  it('rejects a different length without throwing', () => {
    expect(secretsMatch('short', 'much longer secret')).toBe(false);
  });
});
