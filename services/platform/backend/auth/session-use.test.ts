// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_USE_STAMP_MAX_SECONDS,
  sessionUseStampSeconds,
} from './session-use.ts';

describe('how old a recorded use gets before a request records a new one', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    // Better Auth's cadence without an idle window here.
    [60, 60],
    // A cadence tuned longer is still held to the minute.
    [300, SESSION_USE_STAMP_MAX_SECONDS],
    // A window of a minute refreshes every 30 seconds, and records as often.
    [30, 30],
  ])('follows a refresh cadence of %is: %is', (updateAge, seconds) => {
    expect(sessionUseStampSeconds(updateAge)).toBe(seconds);
  });

  it('reads the cadence the deployment runs Better Auth with', () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '');
    expect(sessionUseStampSeconds()).toBe(60);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '1');
    expect(sessionUseStampSeconds()).toBe(30);
  });
});
