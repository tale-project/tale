import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOGIN_BACKOFF_MS,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_TRUSTED_PROXIES,
  type LoginPolicyConfig,
} from '../../lib/shared/schemas/governance';
import {
  computeLockedUntil,
  DEFAULT_LOGIN_POLICY,
  parseLoginPolicy,
  selectStrictestPolicy,
} from './helpers';

const NOW = 1_700_000_000_000;

const policy = (
  overrides: Partial<LoginPolicyConfig> = {},
): LoginPolicyConfig => ({
  enabled: true,
  maxAttemptsBeforeLockout: DEFAULT_LOGIN_MAX_ATTEMPTS,
  backoffSchedule: [...DEFAULT_LOGIN_BACKOFF_MS],
  trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
  ...overrides,
});

describe('computeLockedUntil', () => {
  it('returns null below the threshold', () => {
    expect(computeLockedUntil(0, NOW, policy())).toBeNull();
    expect(computeLockedUntil(4, NOW, policy())).toBeNull();
  });

  it('returns the first delay at exactly the threshold', () => {
    expect(computeLockedUntil(5, NOW, policy())).toBe(NOW + 1_000);
  });

  it('walks the schedule one entry per additional failure', () => {
    expect(computeLockedUntil(6, NOW, policy())).toBe(NOW + 10_000);
    expect(computeLockedUntil(7, NOW, policy())).toBe(NOW + 60_000);
    expect(computeLockedUntil(8, NOW, policy())).toBe(NOW + 600_000);
  });

  it('caps at the last schedule entry for further failures', () => {
    expect(computeLockedUntil(9, NOW, policy())).toBe(NOW + 600_000);
    expect(computeLockedUntil(50, NOW, policy())).toBe(NOW + 600_000);
  });

  it('respects a custom threshold', () => {
    const p = policy({ maxAttemptsBeforeLockout: 3 });
    expect(computeLockedUntil(2, NOW, p)).toBeNull();
    expect(computeLockedUntil(3, NOW, p)).toBe(NOW + 1_000);
  });
});

describe('selectStrictestPolicy', () => {
  it('returns defaults if every input is disabled', () => {
    expect(selectStrictestPolicy([policy({ enabled: false })])).toEqual(
      DEFAULT_LOGIN_POLICY,
    );
  });

  it('prefers the lower lockout threshold', () => {
    const a = policy({ maxAttemptsBeforeLockout: 5 });
    const b = policy({ maxAttemptsBeforeLockout: 3 });
    expect(selectStrictestPolicy([a, b])).toBe(b);
  });

  it('breaks threshold ties by longer first-backoff', () => {
    const a = policy({ backoffSchedule: [1_000, 10_000] });
    const b = policy({ backoffSchedule: [5_000, 10_000] });
    expect(selectStrictestPolicy([a, b])).toBe(b);
  });

  it('skips disabled policies', () => {
    const disabled = policy({ enabled: false, maxAttemptsBeforeLockout: 1 });
    const enabled = policy({ maxAttemptsBeforeLockout: 5 });
    expect(selectStrictestPolicy([disabled, enabled])).toBe(enabled);
  });
});

describe('parseLoginPolicy', () => {
  it('returns defaults on null/empty input', () => {
    expect(parseLoginPolicy(null)).toEqual(DEFAULT_LOGIN_POLICY);
    expect(parseLoginPolicy({})).toEqual(DEFAULT_LOGIN_POLICY);
  });

  it('returns defaults on parse failure rather than throwing', () => {
    expect(parseLoginPolicy({ maxAttemptsBeforeLockout: -1 })).toEqual(
      DEFAULT_LOGIN_POLICY,
    );
  });

  it('parses a valid config', () => {
    const parsed = parseLoginPolicy({
      enabled: false,
      maxAttemptsBeforeLockout: 3,
      backoffSchedule: [500, 5000],
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.maxAttemptsBeforeLockout).toBe(3);
    expect(parsed.backoffSchedule).toEqual([500, 5000]);
  });
});
