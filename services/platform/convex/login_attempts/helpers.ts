import {
  DEFAULT_LOGIN_BACKOFF_MS,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_TRUSTED_PROXIES,
  loginPolicyConfigSchema,
  type LoginPolicyConfig,
} from '../../lib/shared/schemas/governance';

export const DEFAULT_LOGIN_POLICY: LoginPolicyConfig = {
  enabled: true,
  maxAttemptsBeforeLockout: DEFAULT_LOGIN_MAX_ATTEMPTS,
  backoffSchedule: [...DEFAULT_LOGIN_BACKOFF_MS],
  trustedProxies: [...DEFAULT_TRUSTED_PROXIES],
};

/**
 * Compute lockedUntil timestamp for a failure count.
 * Returns null while `failures < threshold`. Past the threshold the schedule
 * advances by one entry per additional failure, capped at the last entry.
 */
export function computeLockedUntil(
  failures: number,
  lastFailureAt: number,
  policy: LoginPolicyConfig,
): number | null {
  if (failures < policy.maxAttemptsBeforeLockout) return null;
  const idx = Math.min(
    failures - policy.maxAttemptsBeforeLockout,
    policy.backoffSchedule.length - 1,
  );
  const delay = policy.backoffSchedule[idx] ?? 0;
  return lastFailureAt + delay;
}

/**
 * Pick the strictest policy across a set of org-scoped configs.
 * Strictest = lowest threshold, longest first backoff entry.
 */
export function selectStrictestPolicy(
  policies: LoginPolicyConfig[],
): LoginPolicyConfig {
  const enabled = policies.filter((p) => p.enabled);
  if (enabled.length === 0) return DEFAULT_LOGIN_POLICY;
  return enabled.reduce((acc, p) => {
    const accFirst = acc.backoffSchedule[0] ?? 0;
    const pFirst = p.backoffSchedule[0] ?? 0;
    const stricter =
      p.maxAttemptsBeforeLockout < acc.maxAttemptsBeforeLockout ||
      (p.maxAttemptsBeforeLockout === acc.maxAttemptsBeforeLockout &&
        pFirst > accFirst);
    return stricter ? p : acc;
  });
}

/**
 * Parse a stored governancePolicies.config payload as a login policy.
 * Returns the defaults on parse failure (defensive — bad rows shouldn't
 * brick sign-in).
 */
export function parseLoginPolicy(raw: unknown): LoginPolicyConfig {
  const parsed = loginPolicyConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_LOGIN_POLICY;
}
