import { CompactEncrypt } from 'jose';
import { describe, expect, it } from 'vitest';

import { disarmBrokenToBase64Shim } from './disarm_broken_to_base64_shim';

describe('disarmBrokenToBase64Shim', () => {
  it('removes an options-blind toBase64 so jose emits base64url JWE', async () => {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value: function (this: Uint8Array) {
        return Buffer.from(
          this.buffer,
          this.byteOffset,
          this.byteLength,
        ).toString('base64');
      },
      writable: true,
      configurable: true,
    });

    disarmBrokenToBase64Shim();
    expect(typeof Uint8Array.prototype.toBase64).toBe('undefined');

    const key = new Uint8Array(32).fill(3);
    const jwe = await new CompactEncrypt(new TextEncoder().encode('tok'))
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(key);
    expect(jwe).not.toMatch(/[+=/]/);
  });

  it('leaves a correct toBase64 alone', () => {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value: function (
        this: Uint8Array,
        options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean },
      ) {
        const encoding =
          options?.alphabet === 'base64url' ? 'base64url' : 'base64';
        let out = Buffer.from(
          this.buffer,
          this.byteOffset,
          this.byteLength,
        ).toString(encoding);
        if (options?.omitPadding) out = out.replace(/=+$/, '');
        return out;
      },
      writable: true,
      configurable: true,
    });

    disarmBrokenToBase64Shim();
    expect(typeof Uint8Array.prototype.toBase64).toBe('function');
  });
});
