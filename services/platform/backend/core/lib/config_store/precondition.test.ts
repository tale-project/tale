import { describe, expect, it } from 'vitest';

import { assertExpectedHash, configSnapshot } from './precondition';

describe('reviewed native configuration preconditions', () => {
  it('distinguishes absent, stale and exact native preimages', () => {
    expect(() => assertExpectedHash(null, null)).not.toThrow();
    expect(() => assertExpectedHash('a'.repeat(64), undefined)).not.toThrow();
    expect(() =>
      assertExpectedHash('a'.repeat(64), 'a'.repeat(64)),
    ).not.toThrow();
    expect(() => assertExpectedHash('a'.repeat(64), null)).toThrowError(
      expect.objectContaining({ code: 'CONFIG_VERSION_CONFLICT', status: 409 }),
    );
    expect(() => assertExpectedHash(null, 'a'.repeat(64))).toThrowError(
      expect.objectContaining({ code: 'CONFIG_VERSION_CONFLICT' }),
    );
  });

  it('never interprets a corrupt or unreadable config as absence or echoes it', () => {
    expect(
      configSnapshot({ ok: false, error: 'not_found', message: 'absent' }),
    ).toEqual({ config: null, hash: null });
    expect(() =>
      configSnapshot({
        ok: false,
        error: 'corrupted',
        message: 'private malformed content',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'CONFIG_UNREADABLE', status: 409 }),
    );
    expect(() =>
      configSnapshot({
        ok: false,
        error: 'corrupted',
        message: 'private malformed content',
      }),
    ).not.toThrow('private malformed content');
  });
});
