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

describe('installPdfjsDomGlobals Map.getOrInsertComputed', () => {
  it('installs the method pdfjs calls on its Maps', () => {
    // Its absence is what broke the operator-list read per page (#3018).
    installPdfjsDomGlobals();
    expect(typeof Map.prototype.getOrInsertComputed).toBe('function');
  });

  it('computes and inserts when the key is absent', () => {
    installPdfjsDomGlobals();
    const map = new Map<string, number>();
    const calls: string[] = [];
    const value = map.getOrInsertComputed('a', (key) => {
      calls.push(key);
      return 1;
    });
    expect(value).toBe(1);
    expect(map.get('a')).toBe(1);
    expect(calls).toEqual(['a']);
  });

  it('returns the existing value without calling the callback', () => {
    // pdfjs relies on this: the callback builds an intent state, and calling
    // it twice would discard the one already in flight.
    installPdfjsDomGlobals();
    const map = new Map<string, number>([['a', 1]]);
    let called = false;
    const value = map.getOrInsertComputed('a', () => {
      called = true;
      return 2;
    });
    expect(value).toBe(1);
    expect(called).toBe(false);
  });

  it('stores a value the callback returns even when it is undefined', () => {
    // Presence, not truthiness: a second call must not recompute.
    installPdfjsDomGlobals();
    const map = new Map<string, undefined>();
    map.getOrInsertComputed('a', () => undefined);
    expect(map.has('a')).toBe(true);
    let recomputed = false;
    map.getOrInsertComputed('a', () => {
      recomputed = true;
      return undefined;
    });
    expect(recomputed).toBe(false);
  });

  it('lets the computed value win when the callback inserted the key itself', () => {
    // The proposal re-checks after the callback and overwrites, so a callback
    // with a side effect cannot leave the map disagreeing with the return.
    installPdfjsDomGlobals();
    const map = new Map<string, number>();
    const value = map.getOrInsertComputed('a', () => {
      map.set('a', 99);
      return 1;
    });
    expect(value).toBe(1);
    expect(map.get('a')).toBe(1);
  });

  it('rejects a callback that is not callable, even when the key exists', () => {
    // Spec order: the callable check comes BEFORE the lookup. Without it, a
    // present key would return happily and a bad callback would go unnoticed
    // until some later call happened to miss.
    installPdfjsDomGlobals();
    const present = new Map<string, number>([['a', 1]]);
    expect(() =>
      (
        present as unknown as {
          getOrInsertComputed: (k: string, f: unknown) => void;
        }
      ).getOrInsertComputed('a', 'not a function'),
    ).toThrow(TypeError);

    const absent = new Map<string, number>();
    expect(() =>
      (
        absent as unknown as {
          getOrInsertComputed: (k: string, f: unknown) => void;
        }
      ).getOrInsertComputed('a', 'not a function'),
    ).toThrow(TypeError);
  });

  it('leaves a real runtime implementation alone', () => {
    // Guarded like every other shim here, so Node ≥24 wins.
    const marker = function (this: Map<unknown, unknown>) {
      return 'native';
    };
    // oxlint-disable-next-line no-extend-native -- test stands in for a native implementation
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value: marker,
      writable: true,
      configurable: true,
    });
    try {
      installPdfjsDomGlobals();
      expect(Map.prototype.getOrInsertComputed).toBe(marker);
    } finally {
      // The guard will not replace a function, so the stand-in has to be
      // removed here or every later suite in this worker inherits it.
      delete (Map.prototype as { getOrInsertComputed?: unknown })
        .getOrInsertComputed;
      installPdfjsDomGlobals();
    }
  });
});
