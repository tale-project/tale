import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSecretKey } from './get_secret_key';

const KEY_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('getSecretKey — one field-encryption root', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decodes ENCRYPTION_SECRET_HEX to the 32-byte key', () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', KEY_HEX);
    const key = getSecretKey();
    expect(key).toHaveLength(32);
    expect(key[0]).toBe(0x00);
    expect(key[31]).toBe(0xff);
  });

  it('refuses a missing key and names the single variable', () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', '');
    expect(() => getSecretKey()).toThrow(/ENCRYPTION_SECRET_HEX is required/);
  });

  it('refuses a key that is not 32 bytes', () => {
    vi.stubEnv('ENCRYPTION_SECRET_HEX', 'abcd');
    expect(() => getSecretKey()).toThrow(/must decode to 32 bytes; got 2/);
  });

  // Regression: the JWE lane used to honour a base64 `ENCRYPTION_SECRET`
  // that the secret box never read, so a deployment configured per the old
  // docs booted and then failed every credential save — or, with both set,
  // silently keyed the two lanes differently.
  it('ignores a legacy ENCRYPTION_SECRET — the hex variable is the contract', () => {
    vi.stubEnv(
      'ENCRYPTION_SECRET',
      'ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8',
    );
    vi.stubEnv('ENCRYPTION_SECRET_HEX', '');
    expect(() => getSecretKey()).toThrow(/ENCRYPTION_SECRET_HEX is required/);
  });
});
