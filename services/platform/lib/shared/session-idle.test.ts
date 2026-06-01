import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseSessionIdleTimeoutMinutes,
  sessionExpiryMs,
  sessionIdleWindowSeconds,
} from './session-idle';

const KEY = 'SESSION_IDLE_TIMEOUT_MINUTES';

afterEach(() => {
  delete process.env[KEY];
  vi.restoreAllMocks();
});

describe('session idle timeout config (#1502)', () => {
  it('is disabled when unset — call sites keep their default lifetime', () => {
    delete process.env[KEY];
    expect(parseSessionIdleTimeoutMinutes()).toBeNull();
    expect(sessionIdleWindowSeconds()).toBeNull();
    expect(sessionExpiryMs(1_000, 5_000)).toBe(6_000); // now + fallback
  });

  it('parses a valid window and builds a sliding Better Auth session config', () => {
    process.env[KEY] = '30';
    expect(parseSessionIdleTimeoutMinutes()).toBe(30);
    // seconds, with a refresh cadence capped at 60s
    expect(sessionIdleWindowSeconds()).toEqual({
      expiresIn: 30 * 60,
      updateAge: 60,
    });
    // manual-session expiry uses the window, not the fallback
    expect(sessionExpiryMs(1_000, 5_000)).toBe(1_000 + 30 * 60 * 1_000);
  });

  it('caps the refresh cadence for short windows', () => {
    process.env[KEY] = '1';
    expect(sessionIdleWindowSeconds()).toEqual({
      expiresIn: 60,
      updateAge: 30,
    });
  });

  it('ignores invalid values and fails open to the default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['abc', '0', '-5']) {
      process.env[KEY] = bad;
      expect(parseSessionIdleTimeoutMinutes()).toBeNull();
    }
    expect(warn).toHaveBeenCalled();
  });

  it('clamps above the 24h maximum', () => {
    process.env[KEY] = '5000';
    expect(parseSessionIdleTimeoutMinutes()).toBe(24 * 60);
  });
});
