// Byte-parity guard for the WebDAV HMAC helpers. The crypto primitives
// (hmacHash / timingSafeEqual) are hand-duplicated in lib/webdav/auth.ts and
// backend/core/webdav/helpers.ts (a split inherited from the retired Convex
// isolate, which could not import from lib/). If the two copies ever drift,
// Basic-auth silently breaks: a password hashed by helpers.ts at create time
// would no longer match the digest auth.ts computes at login. This test pins
// both to the same known-answer vector.

import { describe, expect, it } from 'vitest';

import {
  hmacHash as hmacHashHelpers,
  timingSafeEqual as timingSafeEqualHelpers,
} from '../../backend/core/webdav/helpers';
import {
  hmacHash as hmacHashAuth,
  timingSafeEqual as timingSafeEqualAuth,
} from './auth';

// Same fixed key/password used by test-helpers.ts. EXPECTED is the
// HMAC-SHA256(password, key-bytes) digest; recompute with
// `openssl dgst -sha256 -mac HMAC -macopt hexkey:<KEY_HEX>` if you ever
// intentionally change the algorithm (you almost certainly shouldn't).
const KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PASSWORD = 'app-pass-1234-5678-90ab';
const EXPECTED =
  'a2bbb0a6897a8e7426813c57c6f1bdeeeb45cb8d177e2ff18c22a3f9f6e5ee30';

describe('webdav HMAC helper parity (auth.ts ↔ backend/core/webdav/helpers.ts)', () => {
  it('both hmacHash copies produce the pinned digest', async () => {
    const fromAuth = await hmacHashAuth(PASSWORD, KEY_HEX);
    const fromHelpers = await hmacHashHelpers(PASSWORD, KEY_HEX);
    expect(fromAuth).toBe(EXPECTED);
    expect(fromHelpers).toBe(EXPECTED);
    expect(fromAuth).toBe(fromHelpers);
  });

  it('hmacHash agrees across a range of inputs (drift detector)', async () => {
    for (const pw of ['', 'a', 'unicode-café-🔒', 'x'.repeat(64)]) {
      expect(await hmacHashAuth(pw, KEY_HEX)).toBe(
        await hmacHashHelpers(pw, KEY_HEX),
      );
    }
  });

  it('both timingSafeEqual copies agree', () => {
    const pairs: Array<[string, string]> = [
      ['abc', 'abc'],
      ['abc', 'abd'],
      ['abc', 'abcd'],
      ['', ''],
      [EXPECTED, EXPECTED],
    ];
    for (const [a, b] of pairs) {
      expect(timingSafeEqualAuth(a, b)).toBe(timingSafeEqualHelpers(a, b));
    }
  });
});
