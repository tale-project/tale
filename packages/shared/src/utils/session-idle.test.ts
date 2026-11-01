import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
  SESSION_REFRESH_SECONDS_OUTSIDE_IDLE_WINDOW,
  SESSION_REFRESH_SECONDS_UNDER_IDLE_WINDOW,
  sessionExpiryMs,
  sessionIdleWindowSeconds,
  sessionRefreshShape,
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
    expect(sessionExpiryMs(1_000, 5_000)).toBe(6_000); // now + fallback
  });

  it('keeps the default lifetime but refreshes every five minutes when unset, so updatedAt tracks activity for the idle sweep (#5164)', () => {
    delete process.env[KEY];
    expect(sessionIdleWindowSeconds()).toEqual({
      expiresIn: 7 * 24 * 60 * 60, // Better Auth default, pinned
      updateAge: 5 * 60,
    });
    expect(SESSION_REFRESH_SECONDS_OUTSIDE_IDLE_WINDOW).toBe(5 * 60);
    // A session under an org's window refreshes every minute; the platform's
    // session hooks get there by writing its expiry earlier.
    expect(SESSION_REFRESH_SECONDS_UNDER_IDLE_WINDOW).toBe(60);
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

describe('sessionRefreshShape (#5164)', () => {
  it('advances a session under a window by four minutes when unset, so it refreshes every minute', () => {
    delete process.env[KEY];
    const shape = sessionRefreshShape();
    expect(shape).toEqual({
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 5 * 60,
      advance: 4 * 60,
    });
    // Written that much earlier, the expiry falls due a minute after the write.
    expect(shape.updateAge - shape.advance).toBe(
      SESSION_REFRESH_SECONDS_UNDER_IDLE_WINDOW,
    );
  });

  it('advances nothing when set: every session refreshes every minute already', () => {
    process.env[KEY] = '30';
    expect(sessionRefreshShape()).toEqual({
      expiresIn: 30 * 60,
      updateAge: 60,
      advance: 0,
    });
    process.env[KEY] = '1';
    expect(sessionRefreshShape().advance).toBe(0);
  });
});

describe('resolveEffectiveIdleMinutes (#1502 — org policy × env backstop)', () => {
  it('returns null when neither env nor org policy is configured', () => {
    expect(
      resolveEffectiveIdleMinutes({ policy: null, envMinutes: null }),
    ).toBeNull();
  });

  it('falls back to the env backstop when the org policy is absent', () => {
    expect(resolveEffectiveIdleMinutes({ policy: null, envMinutes: 30 })).toBe(
      30,
    );
  });

  it('falls back to the env backstop when the org policy is disabled', () => {
    expect(
      resolveEffectiveIdleMinutes({
        policy: { enabled: false, idleTimeoutMinutes: 5 },
        envMinutes: 30,
      }),
    ).toBe(30);
  });

  it('lets an enabled org policy TIGHTEN the env backstop', () => {
    expect(
      resolveEffectiveIdleMinutes({
        policy: { enabled: true, idleTimeoutMinutes: 5 },
        envMinutes: 30,
      }),
    ).toBe(5);
  });

  it('never loosens past the env backstop (env is the hard cap)', () => {
    expect(
      resolveEffectiveIdleMinutes({
        policy: { enabled: true, idleTimeoutMinutes: 60 },
        envMinutes: 30,
      }),
    ).toBe(30);
  });

  it('applies the org window as-is when no env backstop is set', () => {
    expect(
      resolveEffectiveIdleMinutes({
        policy: { enabled: true, idleTimeoutMinutes: 15 },
        envMinutes: null,
      }),
    ).toBe(15);
  });
});
