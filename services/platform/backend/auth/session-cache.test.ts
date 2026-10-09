// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_COOKIE_CACHE_MAX_SECONDS,
  sessionCookieCacheOption,
  sessionCookieCacheSeconds,
} from './session-cache.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the session cookie cache', () => {
  it('is off unless SESSION_COOKIE_CACHE_SECONDS asks for it', () => {
    expect(sessionCookieCacheSeconds({})).toBe(0);
    expect(sessionCookieCacheOption({})).toEqual({});
    for (const raw of ['', '0', '-5', 'soon', '1.5']) {
      expect(
        sessionCookieCacheSeconds({ SESSION_COOKIE_CACHE_SECONDS: raw }),
      ).toBe(0);
    }
  });

  it('caches for the asked seconds, capped at five minutes', () => {
    expect(
      sessionCookieCacheOption({ SESSION_COOKIE_CACHE_SECONDS: '30' }),
    ).toEqual({
      cookieCache: { enabled: true, maxAge: 30 },
    });
    expect(
      sessionCookieCacheSeconds({ SESSION_COOKIE_CACHE_SECONDS: '86400' }),
    ).toBe(SESSION_COOKIE_CACHE_MAX_SECONDS);
  });

  it('stays inside a quarter of a deployment-wide idle window', () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '2');
    expect(
      sessionCookieCacheSeconds({ SESSION_COOKIE_CACHE_SECONDS: '120' }),
    ).toBe(30);
  });
});
