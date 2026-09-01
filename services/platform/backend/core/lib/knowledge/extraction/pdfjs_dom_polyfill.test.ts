import { CompactEncrypt, compactDecrypt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { installPdfjsDomGlobals } from './pdfjs_dom_polyfill';

const PROBE = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01]);

/** The options-blind shim that poisoned Convex Node workers after #2414. */
function installBrokenToBase64Shim(): void {
  // oxlint-disable-next-line no-extend-native -- test installs a deliberate poison shim
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
}

afterEach(() => {
  // Leave a correct shim (or native) so later suites aren't poisoned.
  installPdfjsDomGlobals();
});

describe('installPdfjsDomGlobals base64 codecs', () => {
  it('honors alphabet: base64url and omitPadding', () => {
    installBrokenToBase64Shim();
    expect(
      PROBE.toBase64({ alphabet: 'base64url', omitPadding: true }),
    ).toMatch(/[+=/]/);

    installPdfjsDomGlobals();

    const url = PROBE.toBase64({ alphabet: 'base64url', omitPadding: true });
    expect(url).not.toMatch(/[+=/]/);
    expect(url).toBe(Buffer.from(PROBE).toString('base64url'));

    const std = PROBE.toBase64({ alphabet: 'base64' });
    expect(std).toBe(Buffer.from(PROBE).toString('base64'));
  });

  it('replaces a poison toBase64 so jose CompactEncrypt stays base64url', async () => {
    installBrokenToBase64Shim();
    installPdfjsDomGlobals();

    const key = new Uint8Array(32).fill(7);
    const jwe = await new CompactEncrypt(
      new TextEncoder().encode('integration-secret'),
    )
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(key);

    expect(jwe).not.toMatch(/[+=/]/);
    expect(jwe.split('.')[0]?.length).toBe(39);

    const { plaintext } = await compactDecrypt(jwe, key);
    expect(new TextDecoder().decode(plaintext)).toBe('integration-secret');
  });
});
